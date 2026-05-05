import { useEffect, useState } from "react";

const BASE_URL = "http://localhost:8000";

interface Stats {
  total: number;
  high: number;
  medium: number;
  low: number;
  today: number;
}

const CARDS = [
  { key: "total",  label: "Total Emails",     icon: "📧", accent: "#4F46E5", bg: "#EEF2FF",  dot: null },
  { key: "high",   label: "High Priority",    icon: null, accent: "#DC2626", bg: "#FEE2E2",  dot: "#EF4444" },
  { key: "medium", label: "Medium Priority",  icon: null, accent: "#D97706", bg: "#FEF9C3",  dot: "#EAB308" },
  { key: "low",    label: "Low Priority",     icon: null, accent: "#16A34A", bg: "#DCFCE7",  dot: "#22C55E" },
  { key: "today",  label: "Today",            icon: "📅", accent: "#0891B2", bg: "#CFFAFE",  dot: null },
] as const;

export default function DashboardCard() {
  const [stats, setStats] = useState<Stats | null>(() => {
    try {
      const cached = localStorage.getItem("mailpulse-dashboard-stats");
      if (cached) return JSON.parse(cached);
    } catch { /* ignore */ }
    return null;
  });
  const [loading, setLoading] = useState<boolean>(!stats);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = async (refresh = false) => {
    try {
      const url = `${BASE_URL}/dashboard/stats${refresh ? "?refresh=true" : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setStats(data);
      localStorage.setItem("mailpulse-dashboard-stats", JSON.stringify(data));
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    window.dispatchEvent(new Event("refresh-dashboard"));
    loadStats(true).finally(() => setTimeout(() => setRefreshing(false), 800));
  };

  useEffect(() => {
    loadStats(false);
    const handler = () => loadStats(true);
    window.addEventListener("refresh-dashboard", handler);
    return () => window.removeEventListener("refresh-dashboard", handler);
  }, []);

  const getValue = (key: string): number | string => {
    if (!stats) return "—";
    return stats[key as keyof Stats] ?? "—";
  };

  return (
    <>
      <style>{`
        .kpi-row {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 12px;
          margin-bottom: 16px;
          font-family: 'DM Sans', sans-serif;
        }
        @media (max-width: 1100px) {
          .kpi-row { grid-template-columns: repeat(3, 1fr); }
        }

        .kpi-tile {
          background: #fff;
          border: 1px solid #E8EAF0;
          border-radius: 14px;
          padding: 16px 18px;
          display: flex;
          align-items: center;
          gap: 12px;
          position: relative;
          overflow: hidden;
          transition: box-shadow 0.18s, transform 0.18s;
          cursor: default;
        }
        .kpi-tile:hover {
          box-shadow: 0 4px 18px rgba(0,0,0,0.08);
          transform: translateY(-2px);
        }

        /* left color bar */
        .kpi-tile-bar {
          position: absolute;
          left: 0; top: 0;
          width: 4px; height: 100%;
          border-radius: 14px 0 0 14px;
        }

        /* icon circle */
        .kpi-tile-icon {
          width: 38px; height: 38px;
          border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px;
          flex-shrink: 0;
          margin-left: 4px;
        }

        /* dot for priority tiles */
        .kpi-tile-dot {
          width: 10px; height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
          margin-left: 4px;
        }

        .kpi-tile-body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .kpi-tile-label {
          font-size: 10.5px;
          font-weight: 600;
          color: #9CA3AF;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          white-space: nowrap;
        }
        .kpi-tile-value {
          font-size: 26px;
          font-weight: 700;
          color: #1A1D23;
          line-height: 1;
          letter-spacing: -0.02em;
        }
        .kpi-tile-value.loading {
          font-size: 18px;
          color: #D1D5DB;
        }

        /* refresh row */
        .kpi-refresh-row {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 4px;
        }
        .kpi-refresh-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 8px;
          border: 1px solid #E8EAF0;
          background: #fff;
          color: #6B7280;
          font-family: 'DM Sans', sans-serif;
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
        }
        .kpi-refresh-btn:hover { background: #F3F4F6; color: #1A1D23; }
        .kpi-spin { display: inline-block; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="kpi-refresh-row">
        <button className="kpi-refresh-btn" onClick={handleRefresh}>
          <span className={refreshing ? "kpi-spin" : ""}>⟳</span>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="kpi-row">
        {CARDS.map(({ key, label, icon, accent, bg, dot }) => (
          <div className="kpi-tile" key={key}>
            <div className="kpi-tile-bar" style={{ background: accent }} />

            {dot
              ? <div className="kpi-tile-dot" style={{ background: dot }} />
              : <div className="kpi-tile-icon" style={{ background: bg }}>{icon}</div>
            }

            <div className="kpi-tile-body">
              <div className="kpi-tile-label">{label}</div>
              <div className={`kpi-tile-value ${loading ? "loading" : ""}`}>
                {loading ? "—" : getValue(key)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}