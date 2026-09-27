// Runs in every page of the agents' test browsers, before the page's own scripts (Playwright MCP --init-script).
//
// The agents' browser is headless, but on Windows headless Chrome still applies pointer lock to the real mouse: a
// page that locks the pointer (any 3D app, including the office itself) traps the manager's cursor in an invisible
// window and keeps snapping it to that window's centre. So pages get an in-page stand-in instead. The page sees the
// lock granted and released as usual and keeps receiving mouse events, but the real cursor is never touched.
(() => {
  let locked = null;
  const changed = () => queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange')));
  Object.defineProperty(Document.prototype, 'pointerLockElement', {
    configurable: true,
    get: () => (locked && locked.isConnected ? locked : null),
  });
  Element.prototype.requestPointerLock = function () {
    locked = this;
    changed();
    return Promise.resolve();
  };
  Document.prototype.exitPointerLock = function () {
    if (!locked) return;
    locked = null;
    changed();
  };
})();
