// Next 14 days as { iso, label } — iso is yyyy-mm-dd (local), label is
// "Today" / "Tomorrow" / "Mon, Jul 21".
export function buildDayOptions() {
  const days = [];
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let label;
    if (i === 0) label = 'Today';
    else if (i === 1) label = 'Tomorrow';
    else label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    days.push({ iso, label });
  }
  return days;
}

// 4:00 AM to 11:30 PM in 30-minute increments, e.g. "4:00 AM".
export function buildTimeOptions() {
  const times = [];
  for (let mins = 4 * 60; mins <= 23 * 60 + 30; mins += 30) {
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const suffix = h24 < 12 ? 'AM' : 'PM';
    times.push(`${h12}:${String(m).padStart(2, '0')} ${suffix}`);
  }
  return times;
}

// Combine a day iso (yyyy-mm-dd) + a "4:00 AM" time label into a JS Date.
export function combineDayTime(dayIso, timeLabel) {
  const [y, mo, da] = dayIso.split('-').map(Number);
  const match = timeLabel.match(/^(\d+):(\d+)\s(AM|PM)$/);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  if (match[3] === 'PM' && h !== 12) h += 12;
  if (match[3] === 'AM' && h === 12) h = 0;
  return new Date(y, mo - 1, da, h, m);
}
