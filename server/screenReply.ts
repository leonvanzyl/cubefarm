// What GET /api/agents/:id/screen answers. A desk asks for the latest screenshot while a new task may be clearing
// it, so "no screenshot right now" is an ordinary 204, not an error; only an unknown agent is a 404.

/**
 * The status for an agent's screenshot: 200 with the image, 204 when the agent has none right now, 404 when there
 * is no such agent (`undefined`).
 */
export function screenStatus(shot: { data: Buffer; mime: string } | null | undefined): 200 | 204 | 404 {
  if (shot === undefined) return 404;
  return shot ? 200 : 204;
}
