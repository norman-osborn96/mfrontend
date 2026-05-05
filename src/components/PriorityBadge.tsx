type Props = {
  level: string;
  size?: "sm" | "md";
};

const map: Record<string, { className: string; label: string }> = {
  HIGH: { className: "br-pill br-pill--hp", label: "High" },
  MEDIUM: { className: "br-pill br-pill--pr", label: "Medium" },
  LOW: { className: "br-pill br-pill--lp", label: "Low" },
};

export default function PriorityBadge({ level, size = "sm" }: Props) {
  const key = (level || "LOW").toUpperCase();
  const c = map[key] || map["LOW"];
  const pad = size === "md" ? "4px 12px" : undefined;
  return (
    <span className={c.className} style={pad ? { padding: pad, fontSize: "11px" } : undefined}>
      {c.label}
    </span>
  );
}
