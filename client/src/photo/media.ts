// Browser plumbing for shots and clips: which video format this browser records, whether it can record a canvas at
// all, saving a file as a download and copying a picture to the clipboard. Nothing leaves the browser.

/** WebM, best codec first; the first one this browser's MediaRecorder takes, or null. */
export function recordingType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) if (MediaRecorder.isTypeSupported(t)) return t;
  return null;
}

/** Whether clips can be recorded here, and why not when they can't. */
export function clipSupport(canvas: HTMLCanvasElement | null): { ok: true; type: string } | { ok: false; why: string } {
  const type = recordingType();
  if (!canvas || typeof canvas.captureStream !== 'function' || !type)
    return { ok: false, why: "This browser can't record the office (it needs MediaRecorder with WebM, as in Chrome, Edge or Firefox). Shots still work." };
  return { ok: true, type };
}

/** Saves a file through the browser's downloads. */
export function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Puts a PNG on the clipboard; false when the browser or its permissions won't. */
export async function copyImage(png: Blob): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}

export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be encoded'))), type, quality));
}

/** A small JPEG of a canvas for the gallery. */
export function thumbnail(source: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = Math.max(1, Math.round((240 * h) / w));
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
  return canvasBlob(c, 'image/jpeg', 0.8);
}
