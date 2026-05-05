import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import EmailList, { type EmailListInjected, PRIORITY_NAV } from "../components/EmailList";
import CalendarView from "../components/CalendarView";
import InsightView from "../components/InsightView";
import { getUser, logout, type UserProfile } from "../services/auth";
import useEmails, { type Category, markNotificationRead, markAllNotificationsRead, type NotificationItem } from "../hooks/useEmails";
import { getFollowups, markFollowupDone as markFollowupDoneApi } from "../services/api";

const BASE_URL = "http://localhost:8000";

type Stats = { total: number; high: number; medium: number; low: number; today: number };
type NavKey = "Today" | "Inbox" | "Calendar" | "Insight";
type DigestTab = "morning" | "evening" | "weekly";

function firstNameFromProfile(p: UserProfile | null): string {
  if (!p) return "there";
  if (p.given_name?.trim()) return p.given_name.trim();
  if (p.name?.trim()) {
    const parts = p.name.trim().split(/\s+/);
    return parts[0];
  }
  const em = p.email;
  if (em && em !== "user@gmail.com" && em.includes("@")) {
    const local = em.split("@")[0].replace(/[._+-]/g, " ").trim();
    const parts = local.split(" ").filter(Boolean);
    return parts.length ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : local;
  }
  return "there";
}

function profileInitials(p: UserProfile | null): string {
  if (!p) return "?";
  const name = p.given_name || p.name || "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const em = p.email;
  if (em) return em.slice(0, 2).toUpperCase();
  return "?";
}

function profileAvatarColor(p: UserProfile | null): string {
  const seed = p?.email || "default";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 40% 38%)`;
}

function extractSenderName(sender: string) {
  if (!sender) return "";
  const decoded = sender.trim();
  if (decoded.includes("<")) {
    const name = decoded.slice(0, decoded.indexOf("<")).replace(/['"]/g, "").trim();
    if (name) return name;
    const addr = decoded.slice(decoded.indexOf("<") + 1, decoded.indexOf(">")).trim();
    return addr.split("@")[0];
  }
  if (decoded.includes("@")) return decoded.split("@")[0];
  return decoded;
}

function senderInitials(sender: string) {
  const s = extractSenderName(sender);
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (s.length >= 2) return s.slice(0, 2).toUpperCase();
  return "?";
}

function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 45% 42%)`;
}

const MEETING_KW  = /meet|standup|stand.up|zoom|google meet|microsoft teams|calendar|invitation|invite|webinar|conference|sync|agenda|scheduled call|joining link|join us|call at/i;
const ISSUE_KW    = /issue|problem|error|critical|urgent|escalat|blocked|blocker|incident|bug|failure|disruption|complaint|support ticket|customer complaint|service down|outage|not working|broken/i;
const DELEG_KW    = /action required|follow.?up|delegate|assigned to you|waiting on you|pending your|review needed|approval needed|please confirm|deadline|task for you|your input|your action/i;

function isMeeting(e: any)  { const t = `${e.subject} ${e.snippet}`; return MEETING_KW.test(t); }

/** When the meeting occurs (ICS / backend), not necessarily when the invite email was sent. */
function meetingWhenLabel(e: any): string {
  if (e.event_start_iso) {
    const d = new Date(e.event_start_iso);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      });
    }
  }
  if (typeof e.event_start_ms === "number" && e.event_start_ms > 0) {
    const d = new Date(e.event_start_ms);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      });
    }
  }
  if (e.event_date && /^\d{4}-\d{2}-\d{2}$/.test(String(e.event_date))) {
    const parts = String(e.event_date).split("-").map((x: string) => parseInt(x, 10));
    const [y, m, day] = parts;
    if (y && m && day) {
      const d = new Date(y, m - 1, day);
      return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · All day`;
    }
  }
  return e.time ? String(e.time) : "";
}

function meetingSortTs(e: any): number {
  if (typeof e.event_start_ms === "number" && e.event_start_ms > 0) return e.event_start_ms;
  if (e.event_start_iso) {
    const d = new Date(e.event_start_iso);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  if (e.event_date && /^\d{4}-\d{2}-\d{2}$/.test(String(e.event_date))) {
    const [y, m, day] = String(e.event_date).split("-").map((x: string) => parseInt(x, 10));
    if (y && m && day) return new Date(y, m - 1, day).getTime();
  }
  return Number(e.internal_date ?? 0);
}
function isIssue(e: any)    { const t = `${e.subject} ${e.snippet}`; return (e.level === "HIGH") && ISSUE_KW.test(t); }
function isDelegation(e: any) {
  const t = `${e.subject} ${e.snippet}`;
  return e.level === "MEDIUM" || DELEG_KW.test(t);
}

function formatSinceLastMessage(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const h = (Date.now() - t) / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min since last message`;
  if (h < 48) return `${Math.round(h)} h since last message`;
  return `${Math.round(h / 24)} d since last message`;
}

function digestPill(email: { subject?: string; level?: string }) {
  const sub = (email.subject || "").toLowerCase();
  const level = (email.level || "LOW").toUpperCase();
  if (/meet|standup|zoom|calendar|invitation/.test(sub)) return { label: "Meeting Today", cls: "br-pill br-pill--mt" };
  if (level === "HIGH") {
    if (/critical|urgent|escalat|sla|blocker/.test(sub)) return { label: "High Risk", cls: "br-pill br-pill--hr" };
    return { label: "High Priority", cls: "br-pill br-pill--hp" };
  }
  if (level === "MEDIUM") return { label: "Pending Reply", cls: "br-pill br-pill--pr" };
  if (/re:|follow|reminder|fw:/.test(sub)) return { label: "Follow-Up Needed", cls: "br-pill br-pill--fu" };
  return { label: "Low Priority", cls: "br-pill br-pill--lp" };
}

function sortDigest(a: { level?: string }, b: { level?: string }) {
  const o: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return (o[(a.level || "LOW").toUpperCase()] ?? 2) - (o[(b.level || "LOW").toUpperCase()] ?? 2);
}

/** Dashboard “Today” panel: fixed viewport height + internal scroll so long
 *  sections (e.g. Priority inbox) don’t push the whole page and hide the
 *  other columns.
 *
 * `toolbar` — optional strip between title and scroll body (tabs / filters)
 *  stay visible; only `children` scrolls.
 */
function TodayScrollCard({
  title,
  subtitle,
  toolbar,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`br-dash-scroll-card ${className || ""}`}>
      <header className="br-dash-scroll-card__head">
        <h2 className="br-section-title">{title}</h2>
        {subtitle ? <p className="br-section-sub">{subtitle}</p> : null}
      </header>
      {toolbar ? (
        <div className="br-dash-scroll-card__toolbar">{toolbar}</div>
      ) : null}
      <div className="br-dash-scroll-card__body">{children}</div>
    </section>
  );
}

function SettingRow({
  icon,
  label,
  hint,
  danger,
  onClick,
}: {
  icon: string;
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 16px",
        border: "none",
        background: hovered ? (danger ? "#fef2f2" : "#f8f8f6") : "transparent",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--br-font-sans)",
        transition: "background 0.12s",
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: danger ? "#b91c1c" : "var(--br-navy)" }}>{label}</span>
        {hint && <span style={{ display: "block", fontSize: 11, color: "var(--br-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hint}</span>}
      </span>
    </button>
  );
}

export default function Dashboard() {
  const [priority, setPriority] = useState("HIGH");
  const [activeCategory, setActiveCategory] = useState<Category>("All");
  const [activeNav, setActiveNav] = useState<NavKey>("Today");
  const [digestTab, setDigestTab] = useState<DigestTab>("morning");
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoad, setStatsLoad] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [targetEmailId, setTargetEmailId] = useState<string | null>(null);
  const [todayInboxSearch, setTodayInboxSearch] = useState("");
  const settingsRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const emailHook = useEmails(priority);
  const {
    allEmails,
    lastUpdated,
    justUpdated,
    newHighEmails,
    notifications,
    newEmailIds,
    loading: inboxLoading,
    isRefreshing,
    refresh: refreshInbox,
    refreshCount,
  } = emailHook;

  const [followups, setFollowups] = useState<any[]>([]);
  const loadFollowups = useCallback(async () => {
    try {
      const r = await getFollowups();
      setFollowups(r.followups || []);
    } catch {
      setFollowups([]);
    }
  }, []);

  useEffect(() => {
    void loadFollowups();
  }, [loadFollowups, lastUpdated]);

  const handleFollowupDone = async (threadId: string) => {
    try {
      await markFollowupDoneApi(threadId);
      setFollowups((prev) => prev.filter((x) => x.thread_id !== threadId));
    } catch {
      /* ignore */
    }
  };

  const listInjected: EmailListInjected = {
    emails: emailHook.emails,
    loading: emailHook.loading,
    error: emailHook.error,
    refresh: emailHook.refresh,
    loadMore: emailHook.loadMore,
    hasMore: emailHook.hasMore,
    loadingMore: emailHook.loadingMore,
    newEmailIds,
  };

  const digestEmails = useMemo(() => {
    const list = [...allEmails].sort(sortDigest);
    if (digestTab === "morning") return list.slice(0, 6);
    if (digestTab === "evening") return list.slice(0, Math.min(7, list.length));
    return list.slice(0, Math.min(18, list.length));
  }, [allEmails, digestTab]);

  const meetingEmails   = useMemo(() => {
    const list = allEmails.filter(isMeeting);
    list.sort((a, b) => meetingSortTs(a) - meetingSortTs(b));
    return list.slice(0, 5);
  }, [allEmails]);
  const issueEmails     = useMemo(() => allEmails.filter(isIssue).slice(0, 5),     [allEmails]);
  const delegEmails     = useMemo(() => allEmails.filter(isDelegation).slice(0, 5),[allEmails]);

  const loadStats = async (refresh = false) => {
    try {
      const url = `${BASE_URL}/dashboard/stats${refresh ? "?refresh=true" : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setStats(data);
      try {
        localStorage.setItem("mailpulse-dashboard-stats", JSON.stringify(data));
      } catch {
        /* ignore */
      }
    } catch {
      /* silent */
    } finally {
      setStatsLoad(false);
    }
  };

  useEffect(() => {
    getUser().then((u) => setUserProfile(u));
  }, []);

  // Close settings panel when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    if (settingsOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  // Close notification panel when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    if (notifOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [notifOpen]);

  useEffect(() => {
    loadStats(false);
    const h = () => loadStats(true);
    window.addEventListener("refresh-dashboard", h);
    return () => window.removeEventListener("refresh-dashboard", h);
  }, []);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // ── Compute KPI stats directly from allEmails (real-time, no extra API call) ──
  const liveStats = useMemo(() => {
    const total = allEmails.length;
    let high = 0, medium = 0, low = 0, todayCount = 0;
    const todayDate = new Date().toDateString();

    for (const e of allEmails) {
      const lv = (e.level || "LOW").toUpperCase();
      if (lv === "HIGH") high++;
      else if (lv === "MEDIUM") medium++;
      else low++;

      // Count emails received today using internal_date (epoch ms)
      const iDate = Number(e.internal_date || 0);
      if (iDate > 0 && new Date(iDate).toDateString() === todayDate) {
        todayCount++;
      }
    }
    return { total, high, medium, low, today: todayCount };
  }, [allEmails]);

  const s = allEmails.length > 0 ? liveStats : (stats || { total: 0, high: 0, medium: 0, low: 0, today: 0 });
  const statChips = [
    { key: "approvals", label: "Approvals", value: s.today, onClick: () => setActiveNav("Today") },
    { key: "escalations", label: "Escalations", value: s.high, onClick: () => { setPriority("HIGH"); setActiveNav("Today"); } },
    { key: "delegations", label: "Delegations to Review", value: delegEmails.length, onClick: () => { setPriority("MEDIUM"); setActiveNav("Today"); } },
    { key: "pending", label: "Action Pending", value: Math.max(0, s.total - s.low), onClick: () => { setPriority("HIGH"); setActiveNav("Inbox"); } },
    { key: "hp", label: "High Priority", value: s.high, onClick: () => { setPriority("HIGH"); setActiveNav("Today"); } },
    { key: "overdue", label: "Overdue", value: followups.length, onClick: () => setActiveNav("Today") },
  ] as const;

  const digestUpdated = justUpdated
    ? "Updated just now"
    : isRefreshing
      ? "Syncing new mail from Gmail…"
      : lastUpdated
        ? `Last updated ${lastUpdated.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
        : inboxLoading
          ? "Loading inbox…"
          : "Not synced yet";

  const handleLogout = async () => {
    try {
      await logout();
      window.location.href = "/login";
    } catch (e) {
      console.error(e);
    }
  };

  const firstName = firstNameFromProfile(userProfile);
  const initials = profileInitials(userProfile);
  const avatarBg = profileAvatarColor(userProfile);

  const unreadCount = notifications.filter((n: NotificationItem) => !n.read).length;

  const handleNotifClick = (n: NotificationItem) => {
    markNotificationRead(n.id);
    setNotifOpen(false);
    setPriority("HIGH");
    setActiveNav("Inbox");
    setTargetEmailId(n.emailId);
  };

  return (
    <div className="br-app">
      <header className="br-nav">
        <div className="br-nav-inner">
          <a className="br-logo" href="/" onClick={(e) => e.preventDefault()}>
            <span className="br-logo-mark" aria-hidden>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="3" y="3" width="8" height="8" rx="1.5" />
                <rect x="13" y="3" width="8" height="8" rx="1.5" opacity="0.6" />
                <rect x="3" y="13" width="8" height="8" rx="1.5" opacity="0.6" />
                <rect x="13" y="13" width="8" height="8" rx="1.5" />
              </svg>
            </span>
            <span className="br-logo-text">MailPulse</span>
          </a>
          <nav className="br-nav-tabs" aria-label="Main">
            {(["Today", "Inbox", "Calendar", "Insight"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`br-nav-tab ${activeNav === tab ? "is-active" : ""}`}
                onClick={() => setActiveNav(tab)}
              >
                {tab}
              </button>
            ))}
          </nav>
          <div className="br-nav-spacer" />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" className="br-btn-agent" onClick={() => setActiveNav("Inbox")} title="Open inbox">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M12 2a3 3 0 0 0-3 3v1H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1v2h10v-2h1a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3V5a3 3 0 0 0-3-3z" />
                <circle cx="9" cy="13" r="1" fill="currentColor" />
                <circle cx="12" cy="13" r="1" fill="currentColor" />
                <circle cx="15" cy="13" r="1" fill="currentColor" />
              </svg>
              MailPulse Agent
            </button>

            {/* ── Notification Bell ── */}
            <div ref={notifRef} style={{ position: "relative" }}>
              <button
                type="button"
                className="br-notif-bell"
                aria-label="Notifications"
                title="Notifications"
                onClick={() => {
                  setNotifOpen((v) => !v);
                  setSettingsOpen(false);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden>
                  <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6 6 0 0 0-5-5.917V5a1 1 0 0 0-2 0v.083A6 6 0 0 0 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 0 1-6 0v-1m6 0H9" />
                </svg>
                {unreadCount > 0 && (
                  <span className="br-notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
                )}
              </button>

              {notifOpen && (
                <div className="br-notif-panel">
                  <div className="br-notif-header">
                    <span className="br-notif-title">Notifications</span>
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        className="br-notif-clear"
                        onClick={() => { markAllNotificationsRead(); }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  {notifications.length === 0 ? (
                    <div className="br-notif-empty">No notifications yet</div>
                  ) : (
                    <div className="br-notif-list">
                      {notifications.map((n: NotificationItem) => (
                        <button
                          key={n.id}
                          type="button"
                          className={`br-notif-item ${n.read ? "is-read" : ""}`}
                          onClick={() => handleNotifClick(n)}
                        >
                          <div className="br-notif-dot-wrap">
                            {!n.read && <span className="br-notif-dot" />}
                          </div>
                          <div className="br-notif-body">
                            <div className="br-notif-subject">{n.subject}</div>
                            <div className="br-notif-meta">
                              <span>{extractSenderName(n.sender)}</span>
                              <span className="br-notif-time">
                                {n.time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                              </span>
                            </div>
                          </div>
                          <span className="br-notif-arrow">→</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Avatar / Settings trigger ── */}
            <div ref={settingsRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
                aria-label="Account settings"
                title="Account settings"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: userProfile?.picture ? "transparent" : avatarBg,
                  border: "2px solid rgba(255,255,255,0.85)",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.14)",
                  cursor: "pointer",
                  overflow: "hidden",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "box-shadow 0.15s",
                }}
              >
                {userProfile?.picture ? (
                  <img src={userProfile.picture} alt={firstName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", letterSpacing: "0.02em", userSelect: "none" }}>{initials}</span>
                )}
              </button>

              {/* ── Settings dropdown ── */}
              {settingsOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 10px)",
                    right: 0,
                    width: 280,
                    background: "#fff",
                    borderRadius: 14,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
                    border: "1px solid rgba(0,0,0,0.07)",
                    zIndex: 300,
                    overflow: "hidden",
                    animation: "brPop 0.18s ease",
                  }}
                >
                  {/* Profile header */}
                  <div style={{ padding: "18px 18px 14px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        background: userProfile?.picture ? "transparent" : avatarBg,
                        overflow: "hidden",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {userProfile?.picture ? (
                        <img src={userProfile.picture} alt={firstName} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                      ) : (
                        <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{initials}</span>
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--br-navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {userProfile?.name || firstName || "—"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--br-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {userProfile?.email || "Not signed in"}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: userProfile?.provider === "google" ? "#e3f2fd" : "#f3f0ff",
                            color: userProfile?.provider === "google" ? "#1565c0" : "#4338ca",
                          }}
                        >
                          {userProfile?.provider === "google" ? "Google account" : "Email account"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Menu items */}
                  <div style={{ padding: "8px 0" }}>
                    <SettingRow
                      icon="📬"
                      label="Inbox"
                      hint="View all emails"
                      onClick={() => { setActiveNav("Inbox"); setSettingsOpen(false); }}
                    />
                    <SettingRow
                      icon="⚙️"
                      label="Admin panel"
                      hint="Manage VIP senders & rules"
                      onClick={() => { navigate("/admin"); setSettingsOpen(false); }}
                    />
                    <div style={{ height: 1, background: "rgba(0,0,0,0.06)", margin: "6px 0" }} />
                    <SettingRow
                      icon="🔔"
                      label="Notifications"
                      hint="Browser alerts for high-priority"
                      onClick={() => {
                        if ("Notification" in window) Notification.requestPermission();
                        setSettingsOpen(false);
                      }}
                    />
                    <div style={{ height: 1, background: "rgba(0,0,0,0.06)", margin: "6px 0" }} />
                    <SettingRow
                      icon="↩"
                      label="Sign out"
                      hint={userProfile?.email || ""}
                      danger
                      onClick={() => { handleLogout(); setSettingsOpen(false); }}
                    />
                  </div>

                  {/* Footer */}
                  <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(0,0,0,0.05)", fontSize: 11, color: "var(--br-ink-faint)" }}>
                    MailPulse — AI email assistant
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="br-header-block">
        <div>
          <p className="br-date">{dateStr}</p>
          <h1 className="br-greeting">
            {greeting}, {firstName}!
          </h1>
        </div>
        <div className="br-stats" role="toolbar" aria-label="Quick stats">
          {statChips.map((chip, i) => (
            <span key={chip.key} style={{ display: "inline-flex", alignItems: "center" }}>
              {i > 0 && <span className="br-stat-sep">·</span>}
              <button type="button" className="br-stat-chip" onClick={chip.onClick} disabled={statsLoad}>
                {chip.label} <strong>{statsLoad ? "—" : chip.value}</strong>
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="br-main">
        {activeNav === "Today" && (
          <div className="br-grid-3 br-grid-3--today">
            <div className="br-col br-col--today">
              <TodayScrollCard
                className="br-dash-scroll-card--priority"
                title="Digest"
                subtitle={digestUpdated}
                toolbar={
                  <>
                    <div className="br-digest-toolbar-top">
                      <div className="br-digest-tabs" role="tablist">
                        {(
                          [
                            ["morning", "Morning", Math.min(6, allEmails.length)],
                            ["evening", "Evening", Math.min(7, allEmails.length)],
                            ["weekly", "Weekly", Math.min(18, allEmails.length)],
                          ] as const
                        ).map(([id, label, count]) => (
                          <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={digestTab === id}
                            className={`br-digest-tab ${digestTab === id ? "is-active" : ""}`}
                            onClick={() => setDigestTab(id as DigestTab)}
                          >
                            {label} ({String(count).padStart(2, "0")})
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="br-inbox-refresh"
                        onClick={() => refreshInbox()}
                        disabled={inboxLoading || isRefreshing}
                        title="Fetch new mail from Gmail (keeps messages already loaded)"
                      >
                        {isRefreshing ? "Refreshing…" : "Refresh mail"}
                      </button>
                      {refreshCount > 0 && (
                        <span className="br-refresh-count">
                          {refreshCount} new email{refreshCount !== 1 ? "s" : ""} received
                        </span>
                      )}
                    </div>
                    <p className="br-subsection-title br-subsection-title--toolbar">
                      Today’s priorities
                    </p>
                  </>
                }
              >
                {digestEmails.length === 0 && <div className="br-card br-empty">No messages in digest yet. Syncing inbox…</div>}
                {digestEmails.map((email: { id?: string; subject?: string; sender?: string; time?: string; level?: string }) => {
                  const pill = digestPill(email);
                  return (
                    <button
                      key={email.id}
                      type="button"
                      className={`br-card ${(email.level || "").toUpperCase() === "HIGH" ? "br-card--high" : ""}`}
                      style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", border: "none" }}
                      onClick={() => {
                        const L = (email.level || "LOW").toUpperCase();
                        if (L === "MEDIUM") setPriority("MEDIUM");
                        else if (L === "LOW") setPriority("LOW");
                        else setPriority("HIGH");
                        setActiveNav("Inbox");
                      }}
                    >
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--br-navy)", lineHeight: 1.35, marginBottom: 8 }}>
                        {email.subject || "(No subject)"}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span className="br-avatar" style={{ background: avatarColor(email.sender || "") }}>
                            {senderInitials(email.sender || "")}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--br-ink-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {extractSenderName(email.sender || "")}
                          </span>
                        </div>
                        {email.time && <span className="br-ec-time">{email.time}</span>}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                        <span className={pill.cls}>{pill.label}</span>
                      </div>
                    </button>
                  );
                })}
              </TodayScrollCard>

              <TodayScrollCard className="br-dash-scroll-card--compact" title="Delegation board" subtitle="Emails needing your action or follow-up">
                {delegEmails.length === 0 ? (
                  <div className="br-card br-empty">No pending delegation items found.</div>
                ) : (
                  delegEmails.map((email: any) => (
                    <button
                      key={email.id}
                      type="button"
                      className="br-card"
                      style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", border: "none", marginBottom: 10 }}
                      onClick={() => { setPriority(email.level || "MEDIUM"); setActiveNav("Inbox"); setTargetEmailId(email.id); }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span className="br-avatar" style={{ background: avatarColor(email.sender || "") }}>
                          {senderInitials(email.sender || "")}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--br-navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {extractSenderName(email.sender || "")}
                          </div>
                          {email.time && <div style={{ fontSize: 11, color: "var(--br-ink-faint)" }}>{email.time}</div>}
                        </div>
                      </div>
                      <p style={{ fontSize: 12.5, fontWeight: 500, color: "var(--br-navy)", margin: "0 0 6px", lineHeight: 1.35 }}>
                        {email.subject || "(No subject)"}
                      </p>
                      {email.summary && (
                        <div className="br-ai">
                          <div className="br-ai-h"><span className="br-sparkle" aria-hidden>✦</span> AI summary</div>
                          <p className="br-ai-p">{email.summary}</p>
                        </div>
                      )}
                      <div className="br-deleg-foot">
                        <span className={`br-pill ${email.level === "HIGH" ? "br-pill--hp" : "br-pill--pr"}`}>
                          {email.level === "HIGH" ? "High priority" : "Pending reply"}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </TodayScrollCard>
            </div>

            <div className="br-col br-col--today">
              <TodayScrollCard
                className="br-dash-scroll-card--priority"
                title="Priority inbox"
                subtitle="AI-summarized (MailPulse) — choose level below"
                toolbar={
                  <>
                    <div className="br-filter-row br-filter-row--inbox-toolbar">
                      {PRIORITY_NAV.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`br-filter-btn ${priority === p.id ? "is-active" : ""}`}
                          onClick={() => setPriority(p.id)}
                        >
                          {p.label} priority
                        </button>
                      ))}
                    </div>
                    <div className="br-search-wrap">
                      <span className="br-search-icon">🔍</span>
                      <input
                        className="br-search br-search--inbox-toolbar"
                        type="search"
                        placeholder="Search sender or subject…"
                        value={todayInboxSearch}
                        onChange={(e) => setTodayInboxSearch(e.target.value)}
                      />
                    </div>
                  </>
                }
              >
                <div className="br-embed-email-list">
                  <EmailList
                    embedded
                    injected={listInjected}
                    priority={priority}
                    onPriorityChange={setPriority}
                    category={activeCategory}
                    onCategoryChange={setActiveCategory}
                    highlightEmailId={targetEmailId}
                    onHighlightConsumed={() => setTargetEmailId(null)}
                    omitToolbar
                    searchQuery={todayInboxSearch}
                    onSearchQueryChange={setTodayInboxSearch}
                  />
                </div>
              </TodayScrollCard>

              <TodayScrollCard className="br-dash-scroll-card--compact" title="Follow-ups" subtitle="Reply reminders (HIGH or AI: reply required), after a quiet period">
                {followups.length === 0 ? (
                  <div className="br-card br-empty">No pending follow-ups. Checked every ~10 minutes.</div>
                ) : (
                  followups.map((f: any) => (
                    <div
                      key={f.id || f.thread_id}
                      className="br-card"
                      style={{ marginBottom: 10, padding: "12px 14px" }}
                    >
                      <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--br-navy)", margin: "0 0 6px", lineHeight: 1.35 }}>
                        {f.subject || "(No subject)"}
                      </p>
                      <p style={{ fontSize: 12, color: "var(--br-ink-muted)", margin: "0 0 4px" }}>
                        {extractSenderName(f.sender || "")}
                      </p>
                      <p style={{ fontSize: 11, color: "var(--br-ink-faint)", margin: "0 0 8px" }}>
                        {formatSinceLastMessage(f.last_message_at)}
                        {f.requires_reply ? " · AI: reply expected" : ""}
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <span className={`br-pill ${f.priority === "HIGH" ? "br-pill--hp" : "br-pill--pr"}`}>
                          {f.priority === "HIGH" ? "High" : f.priority === "MEDIUM" ? "Medium" : "Low"}
                        </span>
                        <button
                          type="button"
                          className="br-reply-use-btn"
                          style={{ marginLeft: "auto" }}
                          onClick={() => {
                            void handleFollowupDone(f.thread_id);
                          }}
                        >
                          Mark done
                        </button>
                        <button
                          type="button"
                          className="br-reply-use-btn"
                          onClick={() => {
                            setPriority(f.priority === "HIGH" ? "HIGH" : "MEDIUM");
                            setActiveNav("Inbox");
                            if (f.email_id) setTargetEmailId(String(f.email_id));
                          }}
                        >
                          Reply now
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </TodayScrollCard>
            </div>

            <div className="br-col br-col--today">
              <TodayScrollCard className="br-dash-scroll-card--compact" title="Meeting schedule" subtitle="Meeting invites and calendar emails">
                {meetingEmails.length === 0 ? (
                  <div className="br-card br-empty">No meeting invites or calendar emails found.</div>
                ) : (
                  meetingEmails.map((email: any) => {
                    const when = meetingWhenLabel(email);
                    return (
                    <button
                      key={email.id}
                      type="button"
                      className="br-card"
                      style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", border: "none", marginBottom: 12 }}
                      onClick={() => { setPriority(email.level || "HIGH"); setActiveNav("Inbox"); setTargetEmailId(email.id); }}
                    >
                      <p className="br-meet-title">{email.subject || "(No subject)"}</p>
                      {when ? <p className="br-meet-time">{when}</p> : null}
                      <div className="br-attendees">
                        <span className="br-att">
                          <span className="br-avatar" style={{ width: 22, height: 22, fontSize: 9, background: avatarColor(email.sender || "") }}>
                            {senderInitials(email.sender || "")}
                          </span>
                          {extractSenderName(email.sender || "")}
                        </span>
                      </div>
                      {email.summary && (
                        <div className="br-ai" style={{ marginTop: 6 }}>
                          <div className="br-ai-h"><span className="br-sparkle" aria-hidden>✦</span> AI summary</div>
                          <p className="br-ai-p">{email.summary}</p>
                        </div>
                      )}
                    </button>
                    );
                  })
                )}
              </TodayScrollCard>

              <TodayScrollCard className="br-dash-scroll-card--compact" title="Customer issues" subtitle="High-priority escalations requiring a response">
                {issueEmails.length === 0 ? (
                  <div className="br-card br-empty">No urgent issues or escalations found.</div>
                ) : (
                  issueEmails.map((email: any) => (
                    <button
                      key={email.id}
                      type="button"
                      className="br-card"
                      style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", border: "none", marginBottom: 12 }}
                      onClick={() => { setPriority("HIGH"); setActiveNav("Inbox"); setTargetEmailId(email.id); }}
                    >
                      <div className="br-cust-top">
                        <div className="br-cust-id">
                          <span className="br-avatar" style={{ background: avatarColor(email.sender || "") }}>
                            {senderInitials(email.sender || "")}
                          </span>
                          <div>
                            <div className="br-cust-name">{extractSenderName(email.sender || "")}</div>
                            {email.time && <div className="br-cust-co">{email.time}</div>}
                          </div>
                        </div>
                        <span className="br-pill br-pill--hp" style={{ fontSize: 9 }}>High priority</span>
                      </div>
                      <p className="br-issue-type">{email.subject || "(No subject)"}</p>
                      {email.summary && (
                        <div className="br-ai" style={{ marginTop: 4 }}>
                          <div className="br-ai-h"><span className="br-sparkle" aria-hidden>✦</span> AI summary</div>
                          <p className="br-ai-p">{email.summary}</p>
                        </div>
                      )}
                    </button>
                  ))
                )}
              </TodayScrollCard>
            </div>
          </div>
        )}

        {activeNav === "Inbox" && (
          <div className="br-inbox-page">
            <EmailList
              priority={priority}
              onPriorityChange={setPriority}
              category={activeCategory}
              onCategoryChange={setActiveCategory}
              highlightEmailId={targetEmailId}
              onHighlightConsumed={() => setTargetEmailId(null)}
            />
          </div>
        )}

        {activeNav === "Calendar" && (
          <div className="br-cal-page">
            <div className="br-section-h" style={{ marginBottom: 20 }}>
              <h2 className="br-section-title">Calendar</h2>
              <p className="br-section-sub">Meeting invites and calendar emails from your inbox</p>
            </div>
            <CalendarView emails={allEmails} />
          </div>
        )}

        {activeNav === "Insight" && (
          <div className="br-ins-page">
            <div className="br-section-h" style={{ marginBottom: 20 }}>
              <h2 className="br-section-title">Insights</h2>
              <p className="br-section-sub">Trends and analytics from your inbox — {allEmails.length} emails analysed</p>
            </div>
            <InsightView emails={allEmails} />
          </div>
        )}
      </div>

    </div>
  );
}
