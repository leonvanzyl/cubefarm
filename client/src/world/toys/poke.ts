// Toys that do something when you aim at them and press E (the roomba's happy spin). The toy registers a handler
// here; Player calls pokeToy. Kept out of the lazily loaded physics chunk so Player can import it.

const handlers = new Map<string, () => void>();

/** Register what poking `id` does; returns the unregister function. */
export function onPoke(id: string, fn: () => void) {
  handlers.set(id, fn);
  return () => {
    if (handlers.get(id) === fn) handlers.delete(id);
  };
}

export function pokeToy(id: string) {
  handlers.get(id)?.();
}
