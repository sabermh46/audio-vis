/**
 * Plugin registry for scene element classes, keyed by `meta.type`. Mirrors
 * VisualizerRegistry. Adding an element = one new file + one register() call;
 * the editor palette lists whatever is registered.
 */
export class ComponentRegistry {
  #classes = new Map();

  register(ComponentClass) {
    const { type } = ComponentClass.meta;
    if (!type || type === 'base') throw new Error('Component needs a unique static meta.type');
    this.#classes.set(type, ComponentClass);
  }

  has(type) {
    return this.#classes.has(type);
  }

  create(type) {
    const ComponentClass = this.#classes.get(type);
    if (!ComponentClass) throw new Error(`Unknown component: ${type}`);
    return new ComponentClass();
  }

  getClass(type) {
    return this.#classes.get(type) ?? null;
  }

  /** @returns {Array<{type, name, defaults, defaultSignal, signals}>} */
  list() {
    return [...this.#classes.values()].map((cls) => cls.meta);
  }
}
