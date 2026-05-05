import { useState, useEffect, useRef } from "react";
import PriorityBadge from "./PriorityBadge";
import useEmails, { categorizeEmail, type Category } from "../hooks/useEmails";
import {
  markSenderHighPriority,
  addMediumSender,
  removeVipSender,
  removeMediumSender,
  getSuggestedReply,
  sendReply,
} from "../services/api";
import { getUser } from "../services/auth";

export type EmailListInjected = {
  emails: any[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  newEmailIds?: Set<string>;
};

type Props = {
  priority?: string | null;
  category?: Category;
  onPriorityChange?: (p: string) => void;
  onCategoryChange?: (c: Category) => void;
  embedded?: boolean;
  /** When set, uses parent fetch (single `useEmails` in Dashboard) */
  injected?: EmailListInjected;
  /** When set, auto-opens this email by id */
  highlightEmailId?: string | null;
  onHighlightConsumed?: () => void;
  /** Parent renders filter row + search (e.g. `TodayScrollCard` toolbar). Requires `searchQuery` + `onSearchQueryChange`. */
  omitToolbar?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
};

export const PRIORITY_NAV = [
  { id: "HIGH", label: "High" },
  { id: "MEDIUM", label: "Medium" },
  { id: "LOW", label: "Low" },
] as const;

const decodeHTML = (value: string) => {
  if (!value) return "";
  const el = document.createElement("textarea");
  el.innerHTML = value;
  return el.value;
};

const extractEmailAddress = (s: string) => {
  if (!s) return "";
  const t = s.trim();
  if (t.includes("<") && t.includes(">")) {
    return t.slice(t.indexOf("<") + 1, t.indexOf(">")).trim().toLowerCase();
  }
  return t.toLowerCase();
};

const extractSenderName = (s: string) => {
  if (!s) return "";
  const decoded = decodeHTML(s).trim();
  if (decoded.includes("<")) {
    const name = decoded.slice(0, decoded.indexOf("<")).replace(/['"]/g, "").trim();
    if (name) return name;
    const addr = decoded.slice(decoded.indexOf("<") + 1, decoded.indexOf(">")).trim();
    return addr.split("@")[0];
  }
  if (decoded.includes("@")) return decoded.split("@")[0];
  return decoded;
};

// ── Reply template (greeting + body + signature) ───────────────────────────
// Same shape used for both AI suggestions and manual replies, so every email
// the user sends ends up with a consistent header and footer.

const REPLY_CLOSINGS = ["Regards", "Thanks", "Best", "Sincerely"] as const;
type ReplyClosing = typeof REPLY_CLOSINGS[number];

const LS_USER_NAME = "mailpulse:user_name";
const LS_CLOSING = "mailpulse:reply_closing";

function isReplyClosing(x: any): x is ReplyClosing {
  return typeof x === "string" && (REPLY_CLOSINGS as readonly string[]).includes(x);
}

function buildReplyTemplate(opts: {
  body: string;
  recipientName: string;
  userName: string;
  closing: string;
}): string {
  const recipient = (opts.recipientName || "").trim();
  const greeting = recipient ? `Hi ${recipient},` : "Hi,";
  const me = (opts.userName || "").trim() || "Me";
  const close = (opts.closing || "Regards").trim();
  return `${greeting}\n\n${opts.body || ""}\n\n${close},\n${me}`;
}

// Parses the backend time string (e.g. "10:30 AM", "Apr 15", "Apr 15 2024") into a
// human-friendly relative label when the email is recent (today), otherwise falls back
// to the original string.
const formatEmailTime = (raw: string): string => {
  if (!raw) return "";
  // If it looks like a time-only string "HH:MM AM/PM", prefix "Today at"
  if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(raw.trim())) return `Today at ${raw.trim()}`;
  return raw.trim();
};

const CATEGORY_LIST: Category[] = ["All", "VIP", "Work", "Finance", "Social", "Promotions", "Updates", "Other"];
const CAT_SHORT: Record<Category, string> = {
  All: "All",
  VIP: "VIP",
  Work: "Work",
  Finance: "$$",
  Social: "Soc",
  Promotions: "Promo",
  Updates: "Upd",
  Other: "Other",
};

type InnerProps = Props & EmailListInjected & {
  priority: string | null;
  setPriority: (p: string) => void;
  activeCategory: Category;
  setActiveCategory: (c: Category) => void;
  omitToolbar?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
};

function EmailListInner({
  priority,
  setPriority,
  activeCategory,
  setActiveCategory,
  embedded,
  omitToolbar = false,
  searchQuery = "",
  onSearchQueryChange,
  emails,
  loading,
  error,
  refresh,
  loadMore,
  hasMore,
  loadingMore,
  highlightEmailId,
  onHighlightConsumed,
  newEmailIds,
}: InnerProps) {
  const [selectedEmail, setSelectedEmail] = useState<any>(null);
  const [savingRule, setSavingRule] = useState(false);
  const [ruleMessage, setRuleMessage] = useState("");
  const [internalSearch, setInternalSearch] = useState("");
  const search = omitToolbar ? searchQuery : internalSearch;
  const setSearch = omitToolbar && onSearchQueryChange ? onSearchQueryChange : setInternalSearch;
  const [showFullBody, setShowFullBody] = useState(false);

  // Reply state
  const [replyText, setReplyText] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyStatus, setReplyStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Greeting / signature settings (persisted across sessions)
  const [userName, setUserName] = useState<string>(
    () => localStorage.getItem(LS_USER_NAME) || ""
  );
  const [closing, setClosing] = useState<ReplyClosing>(() => {
    const saved = localStorage.getItem(LS_CLOSING);
    return isReplyClosing(saved) ? saved : "Regards";
  });
  const [showReplySettings, setShowReplySettings] = useState(false);

  // Tracks the most recent template we placed in the textarea. If the textarea
  // still equals it, we can safely refresh (e.g. when the user edits their
  // name / closing). If the user has typed over it, we leave it alone.
  const lastTemplateRef = useRef<string>("");

  const recipientName = selectedEmail ? extractSenderName(selectedEmail.sender || "") : "";

  // Persist settings
  useEffect(() => { if (userName) localStorage.setItem(LS_USER_NAME, userName); }, [userName]);
  useEffect(() => { localStorage.setItem(LS_CLOSING, closing); }, [closing]);

  // Load the user's display name from /api/auth/me once
  useEffect(() => {
    if (userName) return;
    let cancelled = false;
    getUser().then((u) => {
      if (cancelled || !u) return;
      const n = u.given_name || u.name || (u.email ? u.email.split("@")[0] : "");
      if (n) setUserName(n);
    }).catch(() => { /* ignore — non-fatal */ });
    return () => { cancelled = true; };
  }, []);

  // Auto-open an email when navigated to from the notification menu
  useEffect(() => {
    if (!highlightEmailId || emails.length === 0) return;
    const target = emails.find((e: any) => e.id === highlightEmailId);
    if (target) {
      setSelectedEmail(target);
      setShowFullBody(false);
      setRuleMessage("");
      onHighlightConsumed?.();
    }
  }, [highlightEmailId, emails]);

  // Fetch AI reply suggestion whenever the modal opens with a new email,
  // and pre-fill the textarea with an empty greeting + signature template
  // so manual replies also get the header/footer by default.
  useEffect(() => {
    if (!selectedEmail) {
      setAiSuggestion("");
      setReplyText("");
      setReplyStatus(null);
      lastTemplateRef.current = "";
      return;
    }
    let cancelled = false;

    const initialTemplate = buildReplyTemplate({
      body: "",
      recipientName,
      userName,
      closing,
    });
    lastTemplateRef.current = initialTemplate;
    setReplyText(initialTemplate);

    setAiSuggestion("");
    setReplyStatus(null);
    setSuggestionLoading(true);
    getSuggestedReply(
      selectedEmail.subject || "",
      selectedEmail.snippet || selectedEmail.body?.slice(0, 500) || "",
      selectedEmail.sender || ""
    )
      .then((data: any) => {
        if (!cancelled) setAiSuggestion(data.suggestion || "");
      })
      .catch(() => { if (!cancelled) setAiSuggestion(""); })
      .finally(() => { if (!cancelled) setSuggestionLoading(false); });
    return () => { cancelled = true; };
  }, [selectedEmail?.id]);

  // If the user changes their name / closing, OR their name finishes loading
  // after the modal opened, refresh the textarea — but ONLY if it still
  // matches the last template we put there. This prevents us from clobbering
  // anything the user typed.
  useEffect(() => {
    if (!selectedEmail) return;
    setReplyText((prev) => {
      if (prev !== lastTemplateRef.current) return prev;
      const next = buildReplyTemplate({
        body: "",
        recipientName,
        userName,
        closing,
      });
      lastTemplateRef.current = next;
      return next;
    });
  }, [userName, closing, recipientName]);

  const isVip =
    selectedEmail?.level === "HIGH" &&
    selectedEmail?.reasons?.some((r: string) => r.toLowerCase().includes("vip") || r.toLowerCase().includes("user marked"));
  const isMedium =
    selectedEmail?.level === "MEDIUM" && selectedEmail?.reasons?.some((r: string) => r.toLowerCase().includes("medium"));

  const filteredEmails = emails.filter((email: any) => {
    const matchesSearch =
      (email.subject || "").toLowerCase().includes(search.toLowerCase()) ||
      (email.sender || "").toLowerCase().includes(search.toLowerCase());
    const matchesCat = activeCategory === "All" || categorizeEmail(email) === activeCategory;
    return matchesSearch && matchesCat;
  });

  const makeAction = (fn: () => Promise<void>) => async () => {
    setSavingRule(true);
    setRuleMessage("");
    try {
      await fn();
    } catch (e: any) {
      setRuleMessage(e.message || "Failed.");
    } finally {
      setSavingRule(false);
    }
  };

  const handleMarkHigh = makeAction(async () => {
    const addr = extractEmailAddress(selectedEmail.sender);
    await markSenderHighPriority(addr);
    await refresh();
    window.dispatchEvent(new Event("refresh-dashboard"));
    setSelectedEmail((p: any) => (p ? { ...p, level: "HIGH", reasons: ["User marked as VIP", ...(p.reasons || [])] } : p));
  });

  const handleSetMedium = makeAction(async () => {
    const addr = extractEmailAddress(selectedEmail.sender);
    await addMediumSender(addr);
    await refresh();
    window.dispatchEvent(new Event("refresh-dashboard"));
    setSelectedEmail((p: any) => (p ? { ...p, level: "MEDIUM", reasons: ["User marked as Medium Priority"] } : p));
  });

  const handleRemoveVip = makeAction(async () => {
    const addr = extractEmailAddress(selectedEmail.sender);
    await removeVipSender(addr);
    await refresh();
    window.dispatchEvent(new Event("refresh-dashboard"));
    setSelectedEmail((p: any) => (p ? { ...p, level: "LOW", reasons: ["VIP removed"] } : p));
  });

  const handleRemoveMedium = makeAction(async () => {
    const addr = extractEmailAddress(selectedEmail.sender);
    await removeMediumSender(addr);
    await refresh();
    window.dispatchEvent(new Event("refresh-dashboard"));
    setSelectedEmail((p: any) => (p ? { ...p, level: "LOW", reasons: ["Medium priority removed"] } : p));
  });

  if (loading) {
    return (
      <div className="br-empty" style={{ padding: embedded ? 24 : 40 }}>
        Loading emails…
      </div>
    );
  }
  if (error) {
    return (
      <div className="br-empty" style={{ color: "#b91c1c" }}>
        {error}
      </div>
    );
  }

  return (
    <div>
      {!embedded && (
        <div className="br-section-h" style={{ marginBottom: 12 }}>
          <div className="br-section-title">Inbox</div>
          <div className="br-section-sub">AI-prioritized messages</div>
        </div>
      )}

      {!omitToolbar && (
        <>
          <div className="br-filter-row">
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
              className="br-search"
              type="search"
              placeholder="Search sender or subject…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </>
      )}

      {filteredEmails.length === 0 && (
        <p className="br-empty" style={{ padding: 20 }}>
          {search || activeCategory !== "All" ? "No emails match your filter" : `No ${(priority || "").toLowerCase()} priority emails`}
        </p>
      )}

      {filteredEmails.map((email: any) => {
        const isSel = selectedEmail?.id === email.id;
        const hp = (email.level || "").toUpperCase() === "HIGH";
        const isNew = newEmailIds?.has(email.id) ?? false;
        const summaryText = email.summary
          ? decodeHTML(email.summary).replace(/<[^>]+>/g, " ").trim()
          : decodeHTML(email.snippet || "").slice(0, 220);
        return (
          <button
            key={email.id}
            type="button"
            className={`br-email-card ${hp ? "br-email-card--hp" : ""} ${isSel ? "is-selected" : ""} ${isNew ? "br-email-card--new" : ""}`}
            onClick={() => {
              setSelectedEmail(email);
              setRuleMessage("");
              setShowFullBody(false);
            }}
          >
            <div className="br-ec-head">
              <div className="br-ec-from">
                <span className="br-avatar" style={{ background: "#4f46e5" }}>
                  {extractSenderName(email.sender || "?").charAt(0).toUpperCase() || "?"}
                </span>
                <span className="br-ec-name">{extractSenderName(email.sender || "")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {isNew && <span className="br-new-badge">New</span>}
                {email.time && (
                  <span className="br-ec-time" title={email.time}>
                    {formatEmailTime(email.time)}
                  </span>
                )}
              </div>
            </div>
            <div className="br-ec-subj">{decodeHTML(email.subject || "(No subject)")}</div>
            <div className="br-ai">
              <div className="br-ai-h">
                <span className="br-sparkle" aria-hidden>
                  ✦
                </span>{" "}
                AI Summary
              </div>
              <p className="br-ai-p">{summaryText || "No summary yet."}</p>
            </div>
            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-start" }}>
              <PriorityBadge level={email.level} />
            </div>
          </button>
        );
      })}

      {hasMore && (
        <button type="button" className="br-loadmore" onClick={() => loadMore()} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}

      {selectedEmail && (
        <div
          className="br-modal-back"
          role="dialog"
          aria-modal="true"
          aria-labelledby="br-email-detail-title"
          onMouseDown={(e) => e.target === e.currentTarget && setSelectedEmail(null)}
        >
          <div className="br-modal">
            <div className="br-modal-top">
              <h2 className="br-modal-title" id="br-email-detail-title">
                Message
              </h2>
              <button type="button" className="br-icon-btn" aria-label="Close" onClick={() => setSelectedEmail(null)}>
                ×
              </button>
            </div>

            <div className="br-field">
              <div className="br-field-l">From</div>
              <div className="br-field-v">{selectedEmail.sender}</div>
            </div>
            <div className="br-field">
              <div className="br-field-l">Subject</div>
              <div className="br-field-v">{selectedEmail.subject}</div>
            </div>
            {selectedEmail.time && (
              <div className="br-field">
                <div className="br-field-l">Received</div>
                <div className="br-field-v">{selectedEmail.time}</div>
              </div>
            )}

            <div className="br-field">
              <div className="br-field-l">Priority</div>
              <PriorityBadge level={selectedEmail.level} size="md" />
            </div>

            <div className="br-field">
              <div className="br-field-l">{showFullBody ? "Full message" : "Preview"}</div>
              <div className="br-field-v" style={{ background: "#fafaf8", padding: 12, borderRadius: 8, maxHeight: 200, overflow: "auto" }}>
                {showFullBody && selectedEmail.body ? (
                  <div dangerouslySetInnerHTML={{ __html: decodeHTML(selectedEmail.body) }} />
                ) : (
                  decodeHTML(selectedEmail.snippet || "No preview available")
                )}
              </div>
            </div>
            {selectedEmail.body && (
              <button type="button" className="br-link" onClick={() => setShowFullBody(!showFullBody)} style={{ marginBottom: 12 }}>
                {showFullBody ? "Show preview" : "Read full email"}
              </button>
            )}

            {selectedEmail?.summary && (
              <div className="br-ai" style={{ marginTop: 8 }}>
                <div className="br-ai-h">
                  <span className="br-sparkle">✦</span> AI Summary
                </div>
                <div className="br-field-v">{decodeHTML(selectedEmail.summary)}</div>
              </div>
            )}

            {selectedEmail?.reasons?.length > 0 && (
              <div className="br-field">
                <div className="br-field-l">Why this rank</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#475569", fontSize: 12.5 }}>
                  {selectedEmail.reasons.map((r: string, i: number) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {selectedEmail?.confidence !== undefined && (
              <p style={{ fontSize: 12, color: "var(--br-ink-faint)" }}>
                Confidence: {(selectedEmail.confidence * 100).toFixed(0)}%
              </p>
            )}

            {/* ── Reply section ── */}
            <div className="br-reply-section">
              <div className="br-reply-header">
                <span className="br-sparkle" aria-hidden>✦</span>
                <span className="br-reply-title">Reply</span>
                <button
                  type="button"
                  className="br-reply-settings-toggle"
                  onClick={() => setShowReplySettings((s) => !s)}
                  title="Greeting & signature settings"
                  aria-expanded={showReplySettings}
                >
                  {showReplySettings ? "Hide signature settings" : "Signature settings"}
                </button>
              </div>

              {/* Greeting / signature settings */}
              {showReplySettings && (
                <div className="br-reply-settings">
                  <label className="br-reply-settings-field">
                    <span>Closing</span>
                    <select
                      value={closing}
                      onChange={(e) => setClosing(e.target.value as ReplyClosing)}
                    >
                      {REPLY_CLOSINGS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label className="br-reply-settings-field">
                    <span>Your name</span>
                    <input
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder="Your name"
                    />
                  </label>
                  <p className="br-reply-settings-hint">
                    Replies will be wrapped as <em>Hi {recipientName || "[recipient]"}, …
                    {closing}, {userName || "[your name]"}</em>.
                  </p>
                </div>
              )}

              {/* AI suggestion banner */}
              {(suggestionLoading || aiSuggestion) && (
                <div className="br-reply-suggestion">
                  {suggestionLoading ? (
                    <div className="br-reply-suggestion-loading">Generating AI reply suggestion…</div>
                  ) : (
                    <>
                      <div className="br-reply-suggestion-label">AI suggested reply</div>
                      <p className="br-reply-suggestion-text">
                        {buildReplyTemplate({
                          body: aiSuggestion,
                          recipientName,
                          userName,
                          closing,
                        })}
                      </p>
                      <button
                        type="button"
                        className="br-reply-use-btn"
                        onClick={() => {
                          const wrapped = buildReplyTemplate({
                            body: aiSuggestion,
                            recipientName,
                            userName,
                            closing,
                          });
                          lastTemplateRef.current = wrapped;
                          setReplyText(wrapped);
                        }}
                      >
                        Use this reply
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Editable reply box */}
              <textarea
                className="br-reply-textarea"
                placeholder="Write your reply here. The greeting and signature are pre-filled — just type your message between them."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={8}
              />

              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 8 }}>
                {replyStatus && (
                  <span style={{ fontSize: 12, color: replyStatus.ok ? "#16a34a" : "#b91c1c", flex: 1 }}>
                    {replyStatus.msg}
                  </span>
                )}
                <button
                  type="button"
                  className="br-reply-send-btn"
                  disabled={sendingReply || !replyText.trim()}
                  onClick={async () => {
                    if (!replyText.trim()) return;
                    setSendingReply(true);
                    setReplyStatus(null);
                    try {
                      await sendReply({
                        to: extractEmailAddress(selectedEmail.sender || ""),
                        subject: selectedEmail.subject || "",
                        body: replyText.trim(),
                        thread_id: selectedEmail.thread_id || "",
                        message_id_header: selectedEmail.message_id_header || "",
                      });
                      setReplyStatus({ ok: true, msg: "Reply sent successfully!" });
                      setReplyText("");
                    } catch (e: any) {
                      setReplyStatus({ ok: false, msg: e.message || "Failed to send reply." });
                    } finally {
                      setSendingReply(false);
                    }
                  }}
                >
                  {sendingReply ? "Sending…" : "Send reply"}
                </button>
              </div>
            </div>

            <div className="br-actions">
              {isVip ? (
                <>
                  <div className="br-pill br-pill--lp" style={{ textAlign: "center", width: "100%", padding: "6px" }}>
                    VIP sender
                  </div>
                  <button type="button" className="br-btn br-btn--neutral" disabled={savingRule} onClick={handleRemoveVip}>
                    {savingRule ? "…" : "Remove VIP"}
                  </button>
                  <button type="button" className="br-btn br-btn--warn" disabled={savingRule} onClick={handleSetMedium}>
                    {savingRule ? "…" : "Set medium priority"}
                  </button>
                </>
              ) : isMedium ? (
                <>
                  <div className="br-pill br-pill--pr" style={{ textAlign: "center", width: "100%", padding: "6px" }}>
                    Medium priority sender
                  </div>
                  <button type="button" className="br-btn br-btn--neutral" disabled={savingRule} onClick={handleRemoveMedium}>
                    {savingRule ? "…" : "Remove medium priority"}
                  </button>
                  <button type="button" className="br-btn br-btn--danger" disabled={savingRule} onClick={handleMarkHigh}>
                    {savingRule ? "…" : "Mark high / VIP"}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="br-btn br-btn--danger" disabled={savingRule} onClick={handleMarkHigh}>
                    {savingRule ? "…" : "Mark sender high priority"}
                  </button>
                  <button type="button" className="br-btn br-btn--warn" disabled={savingRule} onClick={handleSetMedium}>
                    {savingRule ? "…" : "Set medium priority"}
                  </button>
                </>
              )}
              {ruleMessage && <p style={{ color: "#b91c1c", fontSize: 12, textAlign: "center" }}>{ruleMessage}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmailListWithHook(
  rest: Omit<Props, "injected"> & {
    priority: string | null;
    setPriority: (p: string) => void;
    activeCategory: Category;
    setActiveCategory: (c: Category) => void;
  }
) {
  const { priority } = rest;
  const h = useEmails(priority);
  return <EmailListInner {...rest} {...h} />;
}

export default function EmailList({
  priority: priorityProp = "HIGH",
  category: categoryProp = "All",
  onPriorityChange,
  onCategoryChange,
  embedded = false,
  injected,
  highlightEmailId,
  onHighlightConsumed,
  omitToolbar,
  searchQuery,
  onSearchQueryChange,
}: Props) {
  const [localP, setLocalP] = useState(priorityProp);
  const [localC, setLocalC] = useState<Category>(categoryProp);
  const priority = onPriorityChange ? priorityProp! : localP;
  const setPriority = onPriorityChange ?? setLocalP;
  const activeCategory = onCategoryChange ? categoryProp! : localC;
  const setActiveCategory = onCategoryChange ?? setLocalC;

  const common = {
    embedded,
    priority,
    setPriority,
    activeCategory,
    setActiveCategory,
    highlightEmailId,
    onHighlightConsumed,
    omitToolbar,
    searchQuery,
    onSearchQueryChange,
  } as const;

  if (injected) {
    return <EmailListInner {...common} {...injected} />;
  }

  return <EmailListWithHook {...common} />;
}
