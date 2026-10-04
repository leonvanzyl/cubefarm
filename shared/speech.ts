// What a phone message sounds like read aloud: markdown and emoji out, issue numbers and links said the way a person
// would. Used by the server's ElevenLabs voice and by the browser's own voice, so both read the same words.

/** About how much of a message is spoken; the cut lands on a sentence end. */
export const SPEECH_MAX_CHARS = 1500;

/** What the settings' Test button says, in ElevenLabs' voice or the browser's. */
export const SAMPLE_LINE = "Hi! This is how I'll sound when I message you from the office.";

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"]/gi;

/** The words to speak for a message: plain sentences, at most about `max` characters. */
export function speechText(text: string, max = SPEECH_MAX_CHARS): string {
  let s = text.replace(/\r\n?/g, '\n');
  s = s.replace(/```[\s\S]*?(```|$)/g, '\n'); // code blocks aren't worth hearing
  s = s.replace(/`([^`\n]*)`/g, '$1');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/<(https?:[^>\s]+)>/g, '$1');
  s = s.replace(/<\/?[a-z][^>]*>/gi, '');
  s = s.replace(URL, 'a link');
  s = s.replace(EMOJI, '');
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2');
  s = s.replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2');
  s = s.replace(/(^|[^\w])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1$2');
  s = s.replace(/~~(.+?)~~/g, '$1');
  s = s.replace(/#(\d+)\b/g, 'number $1');

  const lines: string[] = [];
  for (let line of s.split('\n')) {
    line = line
      .replace(/^\s*#{1,6}\s+/, '') // headings
      .replace(/^\s*>+\s?/, '') // quotes
      .replace(/^\s*[-*+•]\s+/, '') // bullets
      .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/, '') // table rules
      .replace(/^\s*([-*_]\s*){3,}$/, '') // horizontal rules
      .replace(/\s*\|\s*/g, ', ')
      .replace(/^[,\s]+|[,\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    // A line without its own punctuation (a list item, a heading) still gets a pause.
    lines.push(/[.!?:;,…]$/.test(line) ? line : `${line}.`);
  }
  return cut(lines.join(' ').replace(/\s+([.,!?;:])/g, '$1'), max);
}

/** Cut at the last sentence end within `max`; with none in its second half, at the last word, with an ellipsis. */
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  const ends = [...head.matchAll(/[.!?…](?=\s|$)/g)];
  const end = ends.length ? ends[ends.length - 1].index + 1 : -1;
  if (end >= max / 2) return s.slice(0, end);
  const space = s.lastIndexOf(' ', max);
  return `${s.slice(0, space > 0 ? space : max).replace(/[,;:\s]+$/, '')}…`;
}
