/**
 * DL-155: Reminder date calculator — twice-monthly cadence on 1st & 15th.
 * "Skip one cycle" logic for stage transitions to reminder stages (2 or 4).
 */
export function calcReminderNextDate(): string {
  const now = new Date();
  const day = now.getDate();
  let targetDate: Date;

  if (day < 15) {
    // Next would be 15th this month → skip to 1st next month
    targetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else {
    // Next would be 1st next month → skip to 15th next month
    targetDate = new Date(now.getFullYear(), now.getMonth() + 1, 15);
  }

  return targetDate.toISOString().split('T')[0];
}

/** Check if a stage number is a reminder stage (Waiting_For_Answers=2 or Collecting_Docs=4) */
export function isReminderStage(stageNum: number): boolean {
  return stageNum === 2 || stageNum === 4;
}
