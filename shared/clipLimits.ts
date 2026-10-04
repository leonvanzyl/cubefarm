// How much of the manager's speech one ElevenLabs transcription takes: the browser stops recording at these limits and
// the server refuses anything over them, with the same words on both sides.

/** The longest clip: the recorder stops here. */
export const CLIP_MAX_MS = 60_000;
/** The biggest upload the server reads. */
export const CLIP_MAX_BYTES = 5 * 1024 * 1024;
/** Timers run a little late: a clip may say it's this much over the limit and still be taken. */
export const CLIP_SLACK_MS = 3_000;

/** What MediaRecorder makes in Chromium, Firefox and Safari, plus the usual audio files, by file extension. */
const TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

export const CLIP_TOO_BIG = 'That recording is too long to transcribe: keep it under 60 seconds.';

/** A Content-Type's audio type without its parameters ('audio/webm;codecs=opus' → 'audio/webm'), or '' when it isn't one we take. */
export function clipType(contentType: string | undefined): string {
  const t = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return t in TYPES ? t : '';
}

/** The file extension ElevenLabs is told for a clip of this type. */
export const clipExtension = (type: string) => TYPES[clipType(type)] ?? 'webm';

/** Why a clip can't be transcribed (an HTTP status and words for the manager), or null when it can. */
export function clipProblem(clip: { bytes: number; ms: number; type: string | undefined }): { status: 400 | 413 | 415; message: string } | null {
  if (!clipType(clip.type)) return { status: 415, message: `The office can't transcribe ${clip.type ? `"${clip.type.split(';')[0]}"` : 'that'} audio: send WebM, Ogg, MP4, MP3 or WAV.` };
  if (!(clip.bytes > 0)) return { status: 400, message: 'The recording was empty.' };
  if (clip.bytes > CLIP_MAX_BYTES || (Number.isFinite(clip.ms) && clip.ms > CLIP_MAX_MS + CLIP_SLACK_MS)) return { status: 413, message: CLIP_TOO_BIG };
  return null;
}
