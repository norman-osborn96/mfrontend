import { useState, useMemo } from "react";

// ── helpers ──────────────────────────────────────────────────────────────────

const MEETING_KW =
  /meet|standup|stand.up|zoom|google meet|microsoft teams|calendar|invitation|invite|webinar|conference|sync|agenda|scheduled call|joining link|join us|call at/i;

const LINK_RE =
  /(https?:\/\/([\w.-]*zoom\.us|meet\.google\.com|teams\.microsoft\.com|whereby\.com|webex\.com|gotomeet\.me|bluejeans\.com)\/[^\s"'<>)]+)/gi;

function extractMeetingLink(email: any): string {
  const text = `${email.body || ""} ${email.snippet || ""}`;
  const match = text.match(LINK_RE);
  return match ? match[0].replace(/[).,;]+$/, "") : "";
}

function parseEmailDate(email: any): Date | null {
  // Try raw date header first, fall back to email.time
  const raw = email.date || email.time || "";
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function extractMeetingTime(email: any): string {
  // Try matching "HH:MM AM/PM" or "HH:MM – HH:MM AM/PM" from subject+snippet
  const text = `${email.subject || ""} ${email.snippet || ""}`;
  const m = text.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*[-–]\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i);
  if (m) return m[0].trim();
  if (email.time && /^\d{1,2}:\d{2}/.test(email.time)) return email.time;
  return "";
}

function isMeetingEmail(e: any) {
  return MEETING_KW.test(`${e.subject || ""} ${e.snippet || ""}`);
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function extractSenderName(sender: string) {
  if (!sender) return "";
  const t = sender.trim();
  if (t.includes("<")) {
    const name = t.slice(0, t.indexOf("<")).replace(/['"]/g, "").trim();
    if (name) return name;
    const addr = t.slice(t.indexOf("<") + 1, t.indexOf(">")).trim();
    return addr.split("@")[0];
  }
  if (t.includes("@")) return t.split("@")[0];
  return t;
}

function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360} 45% 42%)`;
}

function senderInitials(sender: string) {
  const s = extractSenderName(sender);
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (s.length >= 2) return s.slice(0, 2).toUpperCase();
  return "?";
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// ── component ────────────────────────────────────────────────────────────────

type Props = { emails: any[] };

export default function CalendarView({ emails }: Props) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date>(today);

  // Filter meeting emails and group by date key
  const meetingsByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    emails.filter(isMeetingEmail).forEach((e) => {
      const d = parseEmailDate(e);
      if (!d) return;
      const key = toDateKey(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return map;
  }, [emails]);

  // All meeting emails (for sidebar when no date selected)
  const allMeetings = useMemo(() => emails.filter(isMeetingEmail), [emails]);

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const year  = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: Array<Date | null> = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));
    // pad to full rows
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [currentMonth]);

  const selectedKey = toDateKey(selectedDate);
  const selectedMeetings = meetingsByDate.get(selectedKey) || [];

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  return (
    <div className="br-cal-wrap">
      {/* ── Left: month grid ── */}
      <div className="br-cal-left">
        <div className="br-cal-nav">
          <button type="button" className="br-cal-nav-btn" onClick={prevMonth}>‹</button>
          <span className="br-cal-month-label">
            {MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </span>
          <button type="button" className="br-cal-nav-btn" onClick={nextMonth}>›</button>
        </div>

        <div className="br-cal-grid">
          {DAY_NAMES.map((d) => (
            <div key={d} className="br-cal-weekday">{d}</div>
          ))}
          {calendarDays.map((day, i) => {
            if (!day) return <div key={`empty-${i}`} className="br-cal-cell br-cal-cell--empty" />;
            const key      = toDateKey(day);
            const isToday  = sameDay(day, today);
            const isSel    = sameDay(day, selectedDate);
            const meetings = meetingsByDate.get(key) || [];
            return (
              <button
                key={key}
                type="button"
                className={`br-cal-cell ${isToday ? "br-cal-cell--today" : ""} ${isSel ? "br-cal-cell--selected" : ""}`}
                onClick={() => setSelectedDate(day)}
              >
                <span className="br-cal-day-num">{day.getDate()}</span>
                {meetings.length > 0 && (
                  <div className="br-cal-dots">
                    {meetings.slice(0, 3).map((_, mi) => (
                      <span key={mi} className="br-cal-dot" />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Mini legend */}
        <div className="br-cal-legend">
          <span className="br-cal-dot" /> Meeting detected from email
        </div>
      </div>

      {/* ── Right: meeting detail panel ── */}
      <div className="br-cal-right">
        <div className="br-cal-detail-header">
          <div className="br-cal-detail-date">
            {selectedDate.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </div>
          <div className="br-cal-detail-count">
            {selectedMeetings.length === 0
              ? "No meetings"
              : `${selectedMeetings.length} meeting${selectedMeetings.length > 1 ? "s" : ""}`}
          </div>
        </div>

        {selectedMeetings.length === 0 ? (
          <div className="br-cal-empty">
            <div className="br-cal-empty-icon">📅</div>
            <div className="br-cal-empty-text">No meetings found for this day.</div>
            <div className="br-cal-empty-sub">
              {allMeetings.length > 0
                ? `You have ${allMeetings.length} meeting email${allMeetings.length > 1 ? "s" : ""} in other days.`
                : "No meeting invites or calendar emails found in your inbox."}
            </div>
          </div>
        ) : (
          <div className="br-cal-meeting-list">
            {selectedMeetings.map((email: any) => {
              const time    = extractMeetingTime(email);
              const link    = extractMeetingLink(email);
              const sender  = extractSenderName(email.sender || "");
              const summary = email.summary || email.snippet || "";

              return (
                <div key={email.id} className="br-cal-meeting-card">
                  <div className="br-cal-meeting-stripe" />
                  <div className="br-cal-meeting-body">
                    {/* Time */}
                    {time && (
                      <div className="br-cal-meeting-time">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                          <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                        </svg>
                        {time}
                      </div>
                    )}

                    {/* Title */}
                    <div className="br-cal-meeting-title">{email.subject || "(No subject)"}</div>

                    {/* Organiser */}
                    <div className="br-cal-meeting-organiser">
                      <span className="br-avatar" style={{ width: 20, height: 20, fontSize: 9, background: avatarColor(email.sender || "") }}>
                        {senderInitials(email.sender || "")}
                      </span>
                      <span>{sender}</span>
                    </div>

                    {/* AI summary */}
                    {summary && (
                      <div className="br-ai" style={{ marginTop: 8 }}>
                        <div className="br-ai-h">
                          <span className="br-sparkle" aria-hidden>✦</span> AI Summary
                        </div>
                        <p className="br-ai-p" style={{ marginBottom: 0 }}>{summary}</p>
                      </div>
                    )}

                    {/* Join link */}
                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="br-cal-join-btn"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                          <path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.82v6.361a1 1 0 0 1-1.447.892L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"/>
                        </svg>
                        Join meeting
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
