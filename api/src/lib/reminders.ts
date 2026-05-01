/**
 * DL-390: Shift Fri/Sat backward to preceding Thursday (Israel work week is Sun-Thu).
 * Mutates and returns the input. Operates on UTC components — `reminder_next_date`
 * is a date-only field so timezone is moot.
 */
export function shiftOffWeekend(d: Date): Date {
  const dow = d.getUTCDay(); // 0=Sun .. 5=Fri, 6=Sat
  if (dow === 5) d.setUTCDate(d.getUTCDate() - 1);
  else if (dow === 6) d.setUTCDate(d.getUTCDate() - 2);
  return d;
}

/**
 * DL-155: Reminder date calculator — twice-monthly cadence on 1st & 15th.
 * "Skip one cycle" logic for stage transitions to reminder stages (2 or 4).
 * DL-390: shifts Fri/Sat backward to Thursday so stored value matches when
 * the DL-389 cron actually fires.
 */
export function calcReminderNextDate(): string {
  const now = new Date();
  const day = now.getDate();
  let targetDate: Date;

  if (day < 15) {
    // Next would be 15th this month → skip to 1st next month
    targetDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  } else {
    // Next would be 1st next month → skip to 15th next month
    targetDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 15));
  }

  shiftOffWeekend(targetDate);
  return targetDate.toISOString().split('T')[0];
}

/** Check if a stage number is a reminder stage (Waiting_For_Answers=2 or Collecting_Docs=4) */
export function isReminderStage(stageNum: number): boolean {
  return stageNum === 2 || stageNum === 4;
}
