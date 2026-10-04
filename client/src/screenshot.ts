// Loading an agent's latest browser screenshot. A new task can clear it between the announce and the fetch (the
// server then answers 204), so a failed load is ignored and whoever asked keeps the image it already had.

/** The screenshot's URL, with its timestamp as the cache buster. */
export function screenshotUrl(agentId: string, at: number) {
  return `/api/agents/${agentId}/screen?t=${at}`;
}

/** Loads the screenshot taken at `at` and calls `onLoad` only if it arrives. Returns a cancel function. */
export function loadScreenshot(agentId: string, at: number | null | undefined, onLoad: (img: HTMLImageElement) => void): () => void {
  if (!at) return () => {};
  let alive = true;
  const img = new Image();
  img.onload = () => alive && onLoad(img);
  img.onerror = () => {};
  img.src = screenshotUrl(agentId, at);
  return () => {
    alive = false;
    img.onload = null;
  };
}
