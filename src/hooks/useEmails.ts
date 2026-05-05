import { useState, useEffect, useCallback, useRef } from "react";
import { getEmails } from "../services/api";

export type Category = "All" | "VIP" | "Work" | "Finance" | "Social" | "Promotions" | "Updates" | "Other";

export type NotificationItem = {
  id: string;
  emailId: string;
  subject: string;
  sender: string;
  time: Date;
  read: boolean;
};

// Module-level so notifications survive tab switches and re-renders
let globalNotifications: NotificationItem[] = [];
let notifListeners: Array<(n: NotificationItem[]) => void> = [];

// Module-level set of "new" email IDs — cleared per email after 30 s
let globalNewEmailIds: Set<string> = new Set();
let newEmailIdListeners: Array<(ids: Set<string>) => void> = [];

function emitNewEmailChange() {
  newEmailIdListeners.forEach((fn) => fn(new Set(globalNewEmailIds)));
}

function emitNotifChange() {
  notifListeners.forEach((fn) => fn([...globalNotifications]));
}

export function markNotificationRead(id: string) {
  globalNotifications = globalNotifications.map((n) => n.id === id ? { ...n, read: true } : n);
  emitNotifChange();
}

export function markAllNotificationsRead() {
  globalNotifications = globalNotifications.map((n) => ({ ...n, read: true }));
  emitNotifChange();
}

export function clearNotifications() {
  globalNotifications = [];
  emitNotifChange();
}

const WORK_KEYWORDS    = ["invoice", "meeting", "project", "deadline", "report", "proposal", "contract", "task", "jira", "confluence", "sprint", "standup", "review", "feedback", "interview", "offer", "hire", "team", "client", "agenda", "action item", "follow up"];
const FINANCE_KEYWORDS = ["payment", "transaction", "receipt", "invoice", "bank", "account", "statement", "tax", "refund", "subscription", "billing", "charge", "debit", "credit", "paypal", "stripe", "venmo", "transfer", "balance", "wallet", "upi", "payout"];
const SOCIAL_KEYWORDS  = ["joined", "connected", "friend", "follow", "mention", "comment", "liked", "shared", "tagged", "instagram", "twitter", "facebook", "linkedin", "whatsapp", "message", "chat", "invite", "group", "community"];
const PROMO_KEYWORDS   = ["offer", "deal", "% off", "discount", "sale", "limited time", "exclusive", "coupon", "promo", "free", "unsubscribe", "marketing", "newsletter", "shop now", "buy now", "flash sale", "clearance"];
const UPDATE_KEYWORDS  = ["updated", "changelog", "release", "version", "deployed", "build", "github", "pull request", "merge", "alert", "notification", "security", "password", "account activity", "sign-in", "logged in", "verify", "confirm"];

export function categorizeEmail(email: any): Category {
  const isVip = email.level === "HIGH" && email.reasons?.some((r: string) =>
        r.toLowerCase().includes("vip") || r.toLowerCase().includes("user marked")
  );
  if (isVip) return "VIP";

  const subject = (email.subject || "").toLowerCase();
  const sender  = (email.sender  || "").toLowerCase();
  const snippet = (email.snippet || "").toLowerCase();
  const text    = subject + " " + sender + " " + snippet;

  if (FINANCE_KEYWORDS.some(k => text.includes(k))) return "Finance";
  if (UPDATE_KEYWORDS.some(k  => text.includes(k))) return "Updates";
  if (PROMO_KEYWORDS.some(k   => text.includes(k))) return "Promotions";
  if (SOCIAL_KEYWORDS.some(k  => text.includes(k))) return "Social";
  if (WORK_KEYWORDS.some(k    => text.includes(k))) return "Work";
  return "Other";
}

// Module-level cache shared across all hook instances — prevents re-fetch on page navigation
let globalEmailCache: any[] = [];
let globalNextPageToken: string | null = null;

const LAST_SYNC_KEY = "mailpulse:last_email_sync_iso";

function readLastSync(): Date | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function writeLastSync() {
  try {
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
}

/** Merge first-page / incremental API results into the existing list (by id), newest first. */
function mergeEmailLists(prev: any[], incoming: any[]): any[] {
  const map = new Map<string, any>(prev.map((e: any) => [e.id, e]));
  for (const e of incoming) {
    const id = e?.id;
    if (!id) continue;
    const old = map.get(id);
    map.set(id, old ? { ...old, ...e } : e);
  }
  return Array.from(map.values()).sort((a: any, b: any) => {
    const ta = Number(a?.internal_date ?? 0);
    const tb = Number(b?.internal_date ?? 0);
    return tb - ta;
  });
}

export default function useEmails(priority: string | null = null) {
  const [emails, setEmails]             = useState<any[]>([]);
  const [allEmails, setAllEmails]       = useState<any[]>(() => [...globalEmailCache]);
  const [loading, setLoading]           = useState(globalEmailCache.length === 0);
  const [isRefreshing, setIsRefreshing]   = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(() => readLastSync());
  const [justUpdated, setJustUpdated]   = useState(false);
  const [newHighEmails, setNewHighEmails] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([...globalNotifications]);
  const [newEmailIds, setNewEmailIds] = useState<Set<string>>(new Set(globalNewEmailIds));
  const [nextPageToken, setNextPageToken] = useState<string | null>(globalNextPageToken);
  const [loadingMore, setLoadingMore]     = useState(false);
  const [refreshCount, setRefreshCount]   = useState(0);

  const allEmailsRef  = useRef<any[]>(globalEmailCache);
  const prevEmailsRef = useRef<any[]>(globalEmailCache);
  /** Until true, always hit the API for the first page so timestamp + server merge run once per session. */
  const firstPageSyncedRef = useRef(false);

  const loadEmails = useCallback(async (forceRefresh = false, token?: string) => {
    const shouldHitApi =
      Boolean(token) ||
      forceRefresh ||
      allEmailsRef.current.length === 0 ||
      !firstPageSyncedRef.current;

    try {
      if (!token && allEmailsRef.current.length === 0) setLoading(true);
      if (token) setLoadingMore(true);
      if (forceRefresh && allEmailsRef.current.length > 0 && !token) setIsRefreshing(true);
      setError(null);

      if (shouldHitApi) {
        // ── Decide between incremental vs full mode ──
        // Incremental: forceRefresh + existing emails + not paginating → send `since`
        // Full: initial load / browser reload / pagination → no `since`
        let sinceTs: number | undefined;
        if (forceRefresh && allEmailsRef.current.length > 0 && !token) {
          const latest = Math.max(
            ...allEmailsRef.current.map((e: any) => Number(e?.internal_date ?? 0))
          );
          if (latest > 0) sinceTs = latest;
        }

        const response = await getEmails(forceRefresh, token, 50, sinceTs);
        const fetchedEmails = response.emails;
        const fetchedToken = response.nextPageToken;
        const isIncremental = response.mode === "incremental";

        // Track how many genuinely new emails the server reported
        if (isIncremental) {
          const count = response.new_count ?? fetchedEmails.length;
          setRefreshCount(count);
          // Auto-clear the count after 5 seconds
          if (count > 0) setTimeout(() => setRefreshCount(0), 5000);
        } else {
          setRefreshCount(0);
        }

        const prevIds = new Set(prevEmailsRef.current.map((e: any) => e.id));
        const newHigh = fetchedEmails.filter((e: any) => e.level === "HIGH" && !prevIds.has(e.id));

        // Track ALL newly arrived emails for the glow effect (non-initial, non-paginated)
        if (!token && prevEmailsRef.current.length > 0) {
          const allNew = fetchedEmails.filter((e: any) => !prevIds.has(e.id));
          if (allNew.length > 0) {
            allNew.forEach((e: any) => globalNewEmailIds.add(e.id));
            emitNewEmailChange();
            // Auto-clear glow after 30 seconds per email
            setTimeout(() => {
              allNew.forEach((e: any) => globalNewEmailIds.delete(e.id));
              emitNewEmailChange();
            }, 30000);
          }
        }

        // Only show notifications if this is NOT the initial load or a paginated load
        if (!token && prevEmailsRef.current.length > 0 && newHigh.length > 0) {
          setNewHighEmails(newHigh);

          // Persist into global notification list
          const existingIds = new Set(globalNotifications.map((n) => n.emailId));
          const fresh: NotificationItem[] = newHigh
            .filter((e: any) => !existingIds.has(e.id))
            .map((e: any) => ({
              id: `notif-${e.id}-${Date.now()}`,
              emailId: e.id,
              subject: e.subject || "(No subject)",
              sender: e.sender || "",
              time: new Date(),
              read: false,
            }));
          if (fresh.length > 0) {
            globalNotifications = [fresh[0], ...globalNotifications].slice(0, 50);
            emitNotifChange();
          }

          // Native Browser Notifications
          if ("Notification" in window) {
            if (Notification.permission === "granted") {
              newHigh.forEach((email: any) => {
                new Notification("🚨 New High Priority Mail", { body: email.subject || "No subject" });
              });
            } else if (Notification.permission !== "denied") {
              Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                  newHigh.forEach((email: any) => {
                    new Notification("🚨 New High Priority Mail", { body: email.subject || "No subject" });
                  });
                }
              });
            }
          }
        }

        let updatedEmails: any[];
        if (token) {
          const newItems = fetchedEmails.filter((e: any) => !prevIds.has(e.id));
          updatedEmails = [...allEmailsRef.current, ...newItems];
        } else if (allEmailsRef.current.length === 0) {
          updatedEmails = fetchedEmails;
        } else {
          // Keep older messages already in the client cache; upsert the latest page from the server.
          updatedEmails = mergeEmailLists(allEmailsRef.current, fetchedEmails);
        }

        prevEmailsRef.current = updatedEmails;
        allEmailsRef.current  = updatedEmails;
        globalEmailCache      = updatedEmails;
        globalNextPageToken   = fetchedToken || null;
        setNextPageToken(fetchedToken || null);

        if (!token) {
          firstPageSyncedRef.current = true;
        }

        const now = new Date();
        writeLastSync();
        setLastUpdated(now);
        setJustUpdated(true);
        setTimeout(() => setJustUpdated(false), 2000);
      } else {
        const persisted = readLastSync();
        if (persisted) setLastUpdated(persisted);
      }

      const full = allEmailsRef.current;
      setAllEmails([...full]);
      let result = full;
      if (priority) {
        result = result.filter((e: any) => (e.level || "").toUpperCase() === priority.toUpperCase());
      }
      setEmails(result);
    } catch (err: any) {
      setError(err.message || "Failed to fetch emails");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setIsRefreshing(false);
    }
  }, [priority]);

  /** Always points at latest loadEmails so SSE reconnects are not tied to priority changes. */
  const loadEmailsRef = useRef(loadEmails);
  loadEmailsRef.current = loadEmails;

  const loadMore = useCallback(() => {
    if (nextPageToken && !loadingMore && !loading) {
      loadEmails(false, nextPageToken);
    }
  }, [nextPageToken, loadingMore, loading, loadEmails]);

  useEffect(() => { 
      loadEmails(false); 
      // Request permission for notifications on mount if not already asked
      if ("Notification" in window && Notification.permission === "default") {
          Notification.requestPermission();
      }
  }, []);

  useEffect(() => {
    const full = allEmailsRef.current;
    setAllEmails([...full]);
    let result = full;
    if (priority) {
      result = result.filter((e: any) => (e.level || "").toUpperCase() === priority.toUpperCase());
    }
    setEmails(result);
  }, [priority]);

  useEffect(() => {
    const handler = () => loadEmails(true);
    window.addEventListener("refresh-dashboard", handler);
    return () => window.removeEventListener("refresh-dashboard", handler);
  }, [loadEmails]);

  // ── Real-time inbox updates via Server-Sent Events ─────────────────────────
  // The backend pushes an `inbox_updated` event whenever incremental_sync finds
  // new, changed, or removed messages. The browser reacts immediately.
  //
  // We also keep a 30 s sanity poll while SSE is *unhealthy* (e.g. backend
  // hasn't started yet, network blip, browser blocked EventSource). Once SSE
  // is healthy again the sanity poll stops.
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let sanityPollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectDelay = 1000;
    let destroyed = false;
    let consecutiveFailures = 0;

    function startSanityPoll() {
      if (sanityPollTimer) return;
      console.log("[mailpulse] SSE unhealthy → starting 30s sanity poll");
      sanityPollTimer = setInterval(() => { void loadEmailsRef.current(true); }, 30000);
    }

    function stopSanityPoll() {
      if (sanityPollTimer) {
        console.log("[mailpulse] SSE healthy → stopping sanity poll");
        clearInterval(sanityPollTimer);
        sanityPollTimer = null;
      }
    }

    function connect() {
      if (destroyed) return;
      console.log("[mailpulse] opening SSE → http://localhost:8000/gmail/events");

      es = new EventSource("http://localhost:8000/gmail/events", {
        withCredentials: true,
      });

      es.onopen = () => {
        console.log("[mailpulse] SSE connected ✓");
        reconnectDelay = 1000;
        consecutiveFailures = 0;
        stopSanityPoll();
      };

      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          console.log("[mailpulse] SSE event received:", data);
          if (data.type === "inbox_updated") {
            void loadEmailsRef.current(true);
          }
        } catch (err) {
          console.warn("[mailpulse] SSE: malformed frame", err, evt.data);
        }
      };

      es.onerror = () => {
        consecutiveFailures += 1;
        console.warn(
          `[mailpulse] SSE error (failure #${consecutiveFailures}) — reconnecting in ${reconnectDelay}ms`
        );
        es?.close();
        if (consecutiveFailures >= 2) startSanityPoll();
        if (!destroyed) {
          reconnectTimer = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 10000);
            connect();
          }, reconnectDelay);
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopSanityPoll();
      es?.close();
    };
    // One stable EventSource per hook instance; loader accessed via loadEmailsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 15-min ultimate safety fallback ────────────────────────────────────────
  // Runs even when SSE is healthy, just in case both SSE *and* the 30s
  // sanity-poll were stopped together by a buggy state transition.
  useEffect(() => {
    const FALLBACK_REFRESH_MS = 15 * 60 * 1000;
    const interval = setInterval(() => { void loadEmailsRef.current(true); }, FALLBACK_REFRESH_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to global notification changes
  useEffect(() => {
    const listener = (n: NotificationItem[]) => setNotifications(n);
    notifListeners.push(listener);
    return () => { notifListeners = notifListeners.filter((l) => l !== listener); };
  }, []);

  // Subscribe to new email ID changes (glow effect)
  useEffect(() => {
    const listener = (ids: Set<string>) => setNewEmailIds(new Set(ids));
    newEmailIdListeners.push(listener);
    return () => { newEmailIdListeners = newEmailIdListeners.filter((l) => l !== listener); };
  }, []);

  return {
    emails,
    allEmails,
    loading,
    isRefreshing,
    error,
    refresh: () => loadEmails(true),
    lastUpdated,
    justUpdated,
    newHighEmails,
    notifications,
    newEmailIds,
    loadMore,
    hasMore: !!nextPageToken,
    loadingMore,
    refreshCount,
  };
}