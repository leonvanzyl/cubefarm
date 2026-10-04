// Where the activity sign over someone's head floats (ActivityIcon.tsx): over the head while they sit, over the name
// tag Character.tsx lifts above them when they stand, and stacked above a speech bubble (SpeechBubble.tsx) rather
// than covering it.

/** The sign's size in metres. */
export const SIGN_SIZE = { w: 1.0, h: 0.1875 };
/** The sign's middle above the floor, seated and standing (the tallest people's name tag included). */
export const SIGN_HEIGHT = { seated: 1.74, standing: 2.2 };
/** Where a speech bubble starts (its tail's tip, tallest people) and the sign's middle once it's clear of the bubble's top. */
export const BUBBLE = { from: 2.0, clear: 2.6 };

/** The sign's height: `sit` is 1 seated and 0 standing (eased in between); `talking` while a bubble shows. */
export function signHeight(sit: number, talking: boolean): number {
  const base = SIGN_HEIGHT.seated * sit + SIGN_HEIGHT.standing * (1 - sit);
  return talking && base + SIGN_SIZE.h / 2 > BUBBLE.from ? BUBBLE.clear : base;
}
