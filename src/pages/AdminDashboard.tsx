import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getVipList, markSenderHighPriority, removeSenderHighPriority, getMediumList, addMediumSender, removeMediumSender } from "../services/api";
import useEmails from "../hooks/useEmails";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, CartesianGrid } from "recharts";

type Tab = "vip" | "medium";

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("vip");
  const [vipList, setVipList] = useState<string[]>([]);
  const [medList, setMedList] = useState<string[]>([]);
  const [newEmail, setNew] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", ok: true });
  const navigate = useNavigate();
  const { emails } = useEmails();

  const loadVip = async () => {
    try {
      const data = await getVipList();
      setVipList(data.high_priority_senders || []);
    } catch {
      /* silent */
    }
  };

  const loadMed = async () => {
    try {
      const data = await getMediumList();
      setMedList(data.medium_senders || []);
    } catch {
      /* silent */
    }
  };

  useEffect(() => {
    loadVip();
    loadMed();
  }, []);

  const addEntry = async () => {
    if (!newEmail.trim()) return;
    setLoading(true);
    setMessage({ text: "", ok: true });
    try {
      if (tab === "vip") await markSenderHighPriority(newEmail.trim());
      else await addMediumSender(newEmail.trim());
      setNew("");
      setMessage({ text: "Added successfully", ok: true });
      tab === "vip" ? loadVip() : loadMed();
    } catch {
      setMessage({ text: "Failed to add", ok: false });
    } finally {
      setLoading(false);
    }
  };

  const removeEntry = async (email: string) => {
    try {
      if (tab === "vip") await removeSenderHighPriority(email);
      else await removeMediumSender(email);
      setMessage({ text: "Removed", ok: true });
      tab === "vip" ? loadVip() : loadMed();
    } catch {
      setMessage({ text: "Failed to remove", ok: false });
    }
  };

  const list = (tab === "vip" ? vipList : medList).filter((e) => e.toLowerCase().includes(searchQuery.toLowerCase()));

  const totalEmails = emails.length;
  const highCount = emails.filter((e) => e.level === "HIGH").length;
  const medCount = emails.filter((e) => e.level === "MEDIUM").length;
  const lowCount = emails.filter((e) => e.level === "LOW").length;

  const vipEmailCount = emails.filter(
    (e) => e.level === "HIGH" && e.reasons?.some((r: string) => r.toLowerCase().includes("vip") || r.toLowerCase().includes("user marked"))
  ).length;
  const nonVipEmailCount = totalEmails - vipEmailCount;

  const priorityData = [
    { name: "HIGH", count: highCount },
    { name: "MEDIUM", count: medCount },
    { name: "LOW", count: lowCount },
  ];

  const dateCounts: Record<string, number> = {};
  emails.forEach((e) => {
    if (e.date) {
      const d = new Date(e.date);
      if (!isNaN(d.getTime())) {
        const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
      }
    }
  });

  const trendData =
    Object.keys(dateCounts).length > 0
      ? Object.entries(dateCounts)
          .map(([day, count]) => ({
            day,
            count,
            _time: new Date(day + " " + new Date().getFullYear()).getTime(),
          }))
          .sort((a, b) => a._time - b._time)
          .map(({ day, count }) => ({ day, count }))
          .slice(-7)
      : [{ day: "Today", count: 0 }];

  const pieData = [
    { name: "VIP emails", value: vipEmailCount },
    { name: "Normal", value: nonVipEmailCount },
  ];
  const PIE_COLORS = ["#1e293b", "#cbd5e1"];

  return (
    <div className="br-admin-root">
      <div className="br-admin-inner">
        <div className="br-admin-head">
          <button type="button" className="br-admin-back" onClick={() => navigate("/")}>
            ← Dashboard
          </button>
          <h1 className="br-admin-h1">Admin — sender rules</h1>
          <span className="br-admin-sub">VIP and medium-priority lists</span>
        </div>

        <div className="br-admin-card">
          <div className="br-admin-tabs">
            <button type="button" className={`br-admin-tab ${tab === "vip" ? "is-active" : ""}`} onClick={() => setTab("vip")}>
              VIP / high priority ({vipList.length})
            </button>
            <button type="button" className={`br-admin-tab ${tab === "medium" ? "is-active" : ""}`} onClick={() => setTab("medium")}>
              Medium priority ({medList.length})
            </button>
          </div>

          <div className="br-admin-body">
            <div className="br-admin-stats">
              <div className="br-admin-stat">
                <div className="br-admin-stat-val">{totalEmails}</div>
                <div className="br-admin-stat-lbl">Total emails</div>
              </div>
              <div className="br-admin-stat">
                <div className="br-admin-stat-val">{highCount}</div>
                <div className="br-admin-stat-lbl">High</div>
              </div>
              <div className="br-admin-stat">
                <div className="br-admin-stat-val">{medCount}</div>
                <div className="br-admin-stat-lbl">Medium</div>
              </div>
              <div className="br-admin-stat">
                <div className="br-admin-stat-val">{lowCount}</div>
                <div className="br-admin-stat-lbl">Low</div>
              </div>
            </div>

            <div className="br-admin-charts">
              <div className="br-admin-chart">
                <h3>Emails by priority</h3>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={priorityData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                      <RTooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: 8, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }} />
                      <Bar dataKey="count" fill="#1e293b" radius={[4, 4, 0, 0]} barSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="br-admin-chart">
                <h3>Emails over time</h3>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                      <RTooltip contentStyle={{ borderRadius: 8, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }} />
                      <Line type="monotone" dataKey="count" stroke="#0f766e" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="br-admin-chart" style={{ marginBottom: 24 }}>
              <h3>VIP vs normal</h3>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} fill="#8884d8" paddingAngle={5} dataKey="value">
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${entry.name}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <RTooltip contentStyle={{ borderRadius: 8, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <h2 style={{ fontFamily: "var(--br-font-display)", fontSize: 17, fontWeight: 600, color: "var(--br-navy)", margin: "0 0 16px" }}>Sender list</h2>

            <div className="br-admin-row">
              <input
                className="br-admin-input"
                placeholder={tab === "vip" ? "Add sender email (e.g. ceo@company.com)" : "Add medium-priority email"}
                value={newEmail}
                onChange={(e) => setNew(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addEntry()}
              />
              <button type="button" className="br-admin-btn" onClick={addEntry} disabled={loading}>
                {loading ? "…" : "Add"}
              </button>
            </div>
            <div className="br-admin-row">
              <input className="br-admin-input" style={{ minWidth: "100%" }} placeholder="Search list…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>

            {message.text && <p className={message.ok ? "br-admin-msg-ok" : "br-admin-msg-err"}>{message.text}</p>}

            <div className="br-admin-list">
              {list.length === 0 ? (
                <div className="br-admin-empty">No {tab === "vip" ? "VIP" : "medium priority"} senders yet.</div>
              ) : (
                list.map((em) => (
                  <div key={em} className="br-admin-item">
                    <span>{em}</span>
                    <button type="button" className="br-admin-remove" onClick={() => removeEntry(em)}>
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
