// Public reminders surface. Internal helpers (parseHhMm, localParts,
// REMINDER_MESSAGES) are intentionally NOT re-exported here — they're
// implementation details, imported directly from './reminders.js' by in-package
// tests. Keep this list to what apps actually consume.
export {
  type DueCheckConfig,
  type ReminderAttempt,
  DEFAULT_REMINDER_TIMES,
  MAX_REMINDER_ATTEMPTS,
  REMINDER_STEP_MINUTES,
  dueReminderSlots,
  reminderMessage,
  snapToReminderStep,
} from './reminders.js';
