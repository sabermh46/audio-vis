/**
 * Plugin registry for visualizer classes. Owned by App (not a singleton).
 * Adding a new visualizer = one new file + one register() call; the
 * template gallery lists whatever is registered.
 */
export class VisualizerRegistry {
  #classes = new Map();

  register(VisualizerClass) {
    const { id } = VisualizerClass.meta;
    if (!id || id === 'base') throw new Error('Visualizer needs a unique static meta.id');
    this.#classes.set(id, VisualizerClass);
  }

  has(id) {
    return this.#classes.has(id);
  }

  create(id, opts) {
    const VisualizerClass = this.#classes.get(id);
    if (!VisualizerClass) throw new Error(`Unknown visualizer: ${id}`);
    return new VisualizerClass(opts);
  }

  getClass(id) {
    return this.#classes.get(id) ?? null;
  }

  /** @returns {Array<{id, name, description}>} metadata for all registered visualizers */
  list() {
    return [...this.#classes.values()].map((cls) => cls.meta);
  }
}
