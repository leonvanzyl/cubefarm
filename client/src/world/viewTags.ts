// userData tags for photo mode, which draws the office from a camera of its own (photo/PhotoScene.tsx): billboards
// (name tags, speech bubbles, signs) turn to face that camera, and what the player holds up in front of their eyes is
// hidden. BILLBOARD goes on drei's <Billboard> (its inner group turns), FACES_CAMERA on a group that turns itself.
export const BILLBOARD = { billboard: true } as const;
export const FACES_CAMERA = { facesCamera: true } as const;
export const FIRST_PERSON = { firstPerson: true } as const;
