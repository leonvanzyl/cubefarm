// The office's "now" for clocks and timers on screen: the moment the time-lapse is showing while it plays
// (replay.ts sets it), else the real time. No dependencies, so pure drawing code can use it.

let replayAt: number | null = null;

/** Epoch ms: the replayed moment during the time-lapse, else Date.now(). */
export const officeNow = () => replayAt ?? Date.now();

/** The replayed moment, or null when the office is live. */
export const replayMoment = () => replayAt;

export function setReplayMoment(at: number | null) {
  replayAt = at;
}
