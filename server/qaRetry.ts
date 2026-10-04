// After a QA session ended: post its report, or resume it once when it ended without one. An office session ends
// with its turn, so a tester who ended a turn to wait on a background task never wakes up again; one nudge in the
// same session (its context and screenshots intact) usually gets the report. A second miss goes back in the queue.

/** What the tester is told when their session is resumed for the missing report. */
export const QA_RESUME_PROMPT = 'Your turn ended without your QA report. Finish what you were checking in the foreground, then end with the JSON report.';

export interface QaEnding {
  /** Stopped by the manager, or interrupted in the terminal. */
  stopped: boolean;
  /** Claude's usage limit is in force. */
  limited: boolean;
  /** The session ended without an error. */
  ok: boolean;
  /** A report could be parsed from the session. */
  report: boolean;
  /** This QA run can still be resumed: it has a session and hasn't been resumed yet. */
  canResume: boolean;
}

/** report: post it. resume: nudge the same session once. give-up: today's path (count the failure, requeue). */
export function qaRetry(e: QaEnding): 'report' | 'resume' | 'give-up' {
  if (e.stopped) return 'give-up';
  if (e.report) return 'report';
  return e.ok && !e.limited && e.canResume ? 'resume' : 'give-up';
}
