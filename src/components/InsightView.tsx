import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, LineChart, Line, Legend,
} from "recharts";
import { categorizeEmail } from "../hooks/useEmails";

// ── colours ──────────────────────────────────────────────────────────────────
const C_HIGH   = "#e53935";
const C_MEDIUM = "#f59e0b";
const C_LOW    = "#10b981";
const C_INDIGO = "#6366f1";
const CAT_COLORS: Record<string, string> = {
  Work:       "#6366f1",
  Finance:    "#f59e0b",
  Updates:    "#0ea5e9",
  Promotions: "#ec4899",
  Social:     "#8b5cf6",
  VIP:        "#e53935",
  Other:      "#94a3b8",
};

// ── helpers ──────────────────────────────────────────────────────────────────
function parseDate(email: any): Date | null {
  const raw = email.date || email.time || "";
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function extractSenderName(sender: string) {
  if (!sender) return "Unknown";
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

function fmt(n: number) { return n.toString(); }

// ── custom tooltip ────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: "#1e293b" }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.color || "#6366f1" }}>{p.name}: <strong>{p.value}</strong></div>
      ))}
    </div>
  );
};

// ── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="br-ins-kpi">
      <div className="br-ins-kpi-val" style={{ color: color || "var(--br-navy)" }}>{value}</div>
      <div className="br-ins-kpi-label">{label}</div>
      {sub && <div className="br-ins-kpi-sub">{sub}</div>}
    </div>
  );
}

// ── section card ─────────────────────────────────────────────────────────────
function SectionCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="br-ins-card">
      <div className="br-ins-card-header">
        <div className="br-ins-card-title">{title}</div>
        {sub && <div className="br-ins-card-sub">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
type Props = { emails: any[] };

export default function InsightView({ emails }: Props) {
  const total = emails.length;

  // Priority distribution
  const priorityData = useMemo(() => {
    const high   = emails.filter(e => (e.level || "").toUpperCase() === "HIGH").length;
    const medium = emails.filter(e => (e.level || "").toUpperCase() === "MEDIUM").length;
    const low    = emails.filter(e => (e.level || "").toUpperCase() === "LOW").length;
    return [
      { name: "High",   value: high,   color: C_HIGH   },
      { name: "Medium", value: medium, color: C_MEDIUM },
      { name: "Low",    value: low,    color: C_LOW    },
    ];
  }, [emails]);

  // Daily volume — last 14 days
  const dailyData = useMemo(() => {
    const today = new Date();
    const days: { date: string; label: string; High: number; Medium: number; Low: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      days.push({
        date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`,
        label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        High: 0, Medium: 0, Low: 0,
      });
    }
    emails.forEach(e => {
      const d = parseDate(e);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const slot = days.find(s => s.date === key);
      if (!slot) return;
      const lv = (e.level || "LOW").toUpperCase() as "HIGH"|"MEDIUM"|"LOW";
      if (lv === "HIGH") slot.High++;
      else if (lv === "MEDIUM") slot.Medium++;
      else slot.Low++;
    });
    return days;
  }, [emails]);

  // Top senders
  const topSenders = useMemo(() => {
    const counts: Record<string, number> = {};
    emails.forEach(e => {
      const name = extractSenderName(e.sender || "");
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));
  }, [emails]);

  // Category breakdown
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    emails.forEach(e => {
      const cat = categorizeEmail(e);
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value, color: CAT_COLORS[name] || "#94a3b8" }));
  }, [emails]);

  // Avg confidence
  const avgConf = useMemo(() => {
    const withConf = emails.filter(e => typeof e.confidence === "number");
    if (!withConf.length) return null;
    return Math.round((withConf.reduce((s, e) => s + e.confidence, 0) / withConf.length) * 100);
  }, [emails]);

  // Response needed = HIGH with no snippet starting with "Re:"
  const responseNeeded = useMemo(
    () => emails.filter(e => e.level === "HIGH" && !/(^re:|^fwd:)/i.test(e.subject || "")).length,
    [emails]
  );

  if (total === 0) {
    return (
      <div className="br-ins-empty">
        <div style={{ fontSize: 40 }}>📊</div>
        <div style={{ fontWeight: 700, fontSize: 16, color: "var(--br-navy)", marginTop: 12 }}>No data yet</div>
        <div style={{ fontSize: 13, color: "var(--br-ink-faint)", marginTop: 6 }}>Insights will appear once your inbox is synced.</div>
      </div>
    );
  }

  const highPct = total ? Math.round((priorityData[0].value / total) * 100) : 0;

  return (
    <div className="br-ins-wrap">

      {/* ── KPI row ── */}
      <div className="br-ins-kpi-row">
        <KpiCard label="Total emails"      value={total}              sub="in your inbox" />
        <KpiCard label="High priority"     value={priorityData[0].value} sub={`${highPct}% of inbox`} color={C_HIGH}   />
        <KpiCard label="Response needed"   value={responseNeeded}     sub="unread high-pri" color="#d97706" />
        <KpiCard label="AI confidence"     value={avgConf !== null ? `${avgConf}%` : "—"} sub="avg classification" color={C_INDIGO} />
      </div>

      {/* ── Row 2: Daily trend + Priority pie ── */}
      <div className="br-ins-row2">

        <SectionCard title="Email volume — last 14 days" sub="Stacked by priority level">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dailyData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barSize={14}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(99,102,241,0.05)" }} />
              <Bar dataKey="High"   stackId="a" fill={C_HIGH}   radius={[0,0,0,0]} />
              <Bar dataKey="Medium" stackId="a" fill={C_MEDIUM} radius={[0,0,0,0]} />
              <Bar dataKey="Low"    stackId="a" fill={C_LOW}    radius={[4,4,0,0]} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Priority breakdown" sub={`${total} emails total`}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={priorityData} cx="50%" cy="50%" innerRadius={44} outerRadius={70}
                  dataKey="value" strokeWidth={2} stroke="#fff">
                  {priorityData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
              {priorityData.map((d) => (
                <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: "var(--br-ink-muted)", flex: 1 }}>{d.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--br-navy)" }}>{d.value}</span>
                  <span style={{ fontSize: 11, color: "var(--br-ink-faint)", minWidth: 36, textAlign: "right" }}>
                    {total ? Math.round(d.value / total * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

      </div>

      {/* ── Row 3: Top senders + Category breakdown ── */}
      <div className="br-ins-row2">

        <SectionCard title="Top senders" sub="By number of emails received">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {topSenders.map((s, i) => {
              const pct = Math.round((s.count / topSenders[0].count) * 100);
              return (
                <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: "var(--br-ink-faint)", width: 14, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: 12.5, color: "var(--br-navy)", minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <div style={{ width: 80, height: 6, borderRadius: 3, background: "#f1f5f9", flexShrink: 0 }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: C_INDIGO }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--br-navy)", width: 24, textAlign: "right", flexShrink: 0 }}>{s.count}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Category breakdown" sub="How your inbox is distributed">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }} barSize={12}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} width={72} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(99,102,241,0.05)" }} />
              <Bar dataKey="value" name="Emails" radius={[0, 4, 4, 0]}>
                {categoryData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

      </div>

    </div>
  );
}
