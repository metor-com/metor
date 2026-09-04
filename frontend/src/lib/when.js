// Messenger-style time label for the bot list: the time today, "Yesterday", the weekday within a
// week, otherwise the date – in the browser's locale.
export function whenLabel(ms) {
  if (!ms) return "";
  const d = new Date(ms), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86400000);
  if (days <= 0) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

// "today 14:00", "tomorrow 07:00", "Yesterday 08:15", "Monday 07:00", otherwise date + time
export function dateTimeLabel(ms) {
  if (!ms) return "";
  const d = new Date(ms), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(now)) / 86400000);
  const t = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `today ${t}`;
  if (days === 1) return `tomorrow ${t}`;
  if (days === -1) return `yesterday ${t}`;
  if (Math.abs(days) < 7) return `${d.toLocaleDateString(undefined, { weekday: "long" })} ${t}`;
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" })} ${t}`;
}
// "in 3 h", "in 2 d", "5 min ago", "just now"
export function relativeLabel(ms) {
  if (!ms) return "";
  const diff = ms - Date.now(), abs = Math.abs(diff);
  const unit = abs < 60000 ? null : abs < 3600000 ? [Math.round(abs / 60000), "min"] : abs < 86400000 ? [Math.round(abs / 3600000), "h"] : [Math.round(abs / 86400000), "d"];
  if (!unit) return diff >= 0 ? "now" : "just now";
  return diff >= 0 ? `in ${unit[0]} ${unit[1]}` : `${unit[0]} ${unit[1]} ago`;
}
