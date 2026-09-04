// Human wording for the 5-field cron expressions routines use (minute hour day month weekday,
// box local time). Covers the shapes bots actually write; anything else falls back to the raw
// expression. English like the rest of the interface.
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "*" → { any: true } · "*/5" → { step: 5 } · "1-5" → { range: [1, 5] } · "1,3,5" → { list: [1, 3, 5] } · "7" → { list: [7] }
function field(f) {
  if (f === "*") return { any: true };
  let m;
  if ((m = /^\*\/(\d+)$/.exec(f))) return { step: Number(m[1]) };
  if ((m = /^(\d+)-(\d+)$/.exec(f))) return { range: [Number(m[1]), Number(m[2])] };
  if (/^\d+(,\d+)*$/.test(f)) return { list: f.split(",").map(Number) };
  return null;
}
const pad = (n) => String(n).padStart(2, "0");
const time = (h, m) => `${pad(h)}:${pad(m)}`;
const ordinal = (n) => `${n}${[, "st", "nd", "rd"][(n % 100 >> 3 ^ 1) && n % 10] || "th"}`;
const join = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// Which days: weekdays, weekends, named days, a day of the month – or every day
function dayPhrase(dom, mon, dow) {
  const inMonths = mon.any ? "" : mon.list ? ` in ${join(mon.list.map((x) => MONTHS[x - 1] ?? x))}` : mon.range ? ` from ${MONTHS[mon.range[0] - 1]} to ${MONTHS[mon.range[1] - 1]}` : "";
  if (dom.any && dow.any) return { every: `Every day${inMonths}`, on: `every day${inMonths}` };
  if (dom.any) {
    const days = dow.list ? dow.list : dow.range ? Array.from({ length: dow.range[1] - dow.range[0] + 1 }, (_, i) => dow.range[0] + i) : null;
    if (!days) return null;
    const set = new Set(days.map((d) => d % 7));
    const isWeekdays = set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d));
    const isWeekend = set.size === 2 && set.has(0) && set.has(6);
    const label = isWeekdays ? "weekdays" : isWeekend ? "weekends" : join([...set].sort().map((d) => `${DAYS[d]}s`));
    return { every: `${label[0].toUpperCase()}${label.slice(1)}${inMonths}`, on: `${label}${inMonths}` };
  }
  if (dow.any && dom.list) return { every: `On the ${join(dom.list.map(ordinal))} of ${mon.any ? "every month" : inMonths.replace(/^ in /, "")}`, on: `on the ${join(dom.list.map(ordinal))}` };
  return null;
}

export function describeCron(expr) {
  const parts = String(expr ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts.map(field);
  if (!min || !hour || !dom || !mon || !dow) return null;
  const days = dayPhrase(dom, mon, dow);
  if (!days) return null;
  const everyDay = dom.any && dow.any && mon.any;
  // fixed minute + fixed hour(s) → "… at 07:00"
  if (min.list?.length === 1 && hour.list) {
    const times = hour.list.map((h) => time(h, min.list[0]));
    return `${days.every} at ${join(times)}`;
  }
  // fixed minute, every hour / every n hours / a span of hours
  if (min.list?.length === 1) {
    const at = min.list[0] === 0 ? "on the hour" : `at :${pad(min.list[0])}`;
    const when = everyDay ? "" : `, ${days.on}`;
    if (hour.any) return `Every hour ${at}${when}`;
    if (hour.step) return `Every ${hour.step} hours ${at}${when}`;
    if (hour.range) return `Every hour ${at} from ${time(hour.range[0], 0)} to ${time(hour.range[1], 59)}${when}`;
  }
  // every n minutes (optionally within hours)
  if (min.step && hour.any) return `Every ${min.step} minutes${everyDay ? "" : `, ${days.on}`}`;
  if (min.step && hour.range) return `Every ${min.step} minutes from ${time(hour.range[0], 0)} to ${time(hour.range[1], 59)}${everyDay ? "" : `, ${days.on}`}`;
  if (min.any && hour.any) return `Every minute${everyDay ? "" : `, ${days.on}`}`;
  return null;
}
