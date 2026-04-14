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
