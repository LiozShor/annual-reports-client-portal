export function isOffHours(): boolean {
  const hour = getIsraelHour();
  return hour >= 20 || hour < 8;
}

export function getIsraelHour(): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  );
}

/**
 * Returns the next 08:00 Israel time as a UTC ISO 8601 string
 * suitable for MS Graph PidTagDeferredSendTime.
 * If Israel time is before 08:00 → today at 08:00.
 * If Israel time is 08:00 or later → tomorrow at 08:00.
 */
export function getNext0800Israel(): string {
  const now = new Date();
  // Get current Israel date parts (DST-safe)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const y = parseInt(parts.find(p => p.type === 'year')!.value);
  const m = parseInt(parts.find(p => p.type === 'month')!.value) - 1;
  const d = parseInt(parts.find(p => p.type === 'day')!.value);
  const h = parseInt(parts.find(p => p.type === 'hour')!.value);

  // Build 08:00 Israel for today or tomorrow
  const targetDay = h < 8 ? d : d + 1;

  // Create a date in Israel timezone at 08:00, then convert to UTC
  // Use a temporary date to find the UTC offset for Israel at that moment
  const israelDate = new Date(Date.UTC(y, m, targetDay, 8, 0, 0));
  // israelDate is wrong — it's 08:00 UTC, but we need 08:00 Israel.
  // Compute the Israel→UTC offset by comparing formatted vs UTC hours
  const testParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(israelDate);
  const israelHourAtUtc8 = parseInt(testParts.find(p => p.type === 'hour')!.value);
  const offsetHours = israelHourAtUtc8 - 8; // e.g., 11-8=3 (Israel is UTC+3 in summer)

  // Subtract the offset to get the UTC time when Israel is 08:00
  const utcTarget = new Date(Date.UTC(y, m, targetDay, 8 - offsetHours, 0, 0));
  return utcTarget.toISOString().replace('.000Z', '.0000000Z');
}

// 0=Sun, 1=Mon, ... 5=Fri, 6=Sat. Israel work-week is Sun–Thu.
export function getIsraelDayOfWeek(d: Date = new Date()): number {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
  }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

export function isWeekend(d: Date = new Date()): boolean {
  const dow = getIsraelDayOfWeek(d);
  return dow === 5 || dow === 6;
}

export function isOffHoursOrWeekend(): boolean {
  return isOffHours() || isWeekend();
}

/**
 * Returns the next 08:00 Israel time as a UTC ISO string, skipping
 * Friday and Saturday Israel calendar days. Used by every client-facing
 * email path so weekend approvals defer to Sunday morning.
 *
 * Example: Friday 10:00 Israel → Sunday 08:00 Israel.
 */
export function getNextBusinessMorning0800Israel(): string {
  let iso = getNext0800Israel();
  // At most 2 advances needed (Fri→Sat→Sun). Cap at 3 as defence.
  for (let i = 0; i < 3; i++) {
    if (!isWeekend(new Date(iso))) return iso;
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() + 1);
    iso = d.toISOString().replace('.000Z', '.0000000Z');
  }
  return iso;
}
