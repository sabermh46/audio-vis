/**
 * Minimal event emitter base class.
 * `on()` returns an unsubscribe function so consumers (including a future
 * React wrapper's useEffect) can clean up without keeping handler refs.
 */
export class EventEmitter {
  #listeners = new Map();

  on(event, handler) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this.#listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    const handlers = this.#listeners.get(event);
    if (!handlers) return;
    for (const handler of [...handlers]) handler(payload);
  }

  removeAllListeners() {
    this.#listeners.clear();
  }
}
