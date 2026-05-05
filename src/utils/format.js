/**
 * Format an ISO date string to a human-readable time (e.g. "10:30 AM")
 */
export function formatTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Format an ISO date string to a short date (e.g. "Apr 14")
 */
export function formatDate(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Return a relative time string (e.g. "2 hours ago")
 */
export function formatRelativeTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
