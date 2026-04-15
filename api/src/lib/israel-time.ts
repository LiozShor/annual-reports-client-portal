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
