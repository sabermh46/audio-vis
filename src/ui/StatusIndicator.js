/**
 * Output-only stage overlay: a busy spinner ("Analyzing audio…") and a
 * corner badge for the analysis mode. No events — App drives it.
 */
export class StatusIndicator {
  #busyEl = null;
  #badgeEl = null;
  #hideTimer = 0;

  attach(stage) {
    this.#busyEl = document.createElement('div');
    this.#busyEl.className = 'av-busy';
    this.#busyEl.innerHTML = '<div class="av-spinner"></div><div class="av-busy-text"></div>';
    stage.appendChild(this.#busyEl);

    this.#badgeEl = document.createElement('div');
    this.#badgeEl.className = 'av-mode-badge';
    stage.appendChild(this.#badgeEl);
  }

  /** Shows the spinner with the given text; null hides it. */
  setBusy(text) {
    this.#busyEl.classList.toggle('visible', !!text);
    if (text) this.#busyEl.querySelector('.av-busy-text').textContent = text;
  }

  /**
   * 'precomputed' shows a brief auto-hiding confirmation; 'realtime' shows
   * a persistent fallback badge; null clears.
   */
  setMode(mode) {
    clearTimeout(this.#hideTimer);
    this.#badgeEl.classList.remove('visible', 'realtime');
    if (mode === 'precomputed') {
      this.#badgeEl.textContent = '✓ Full analysis';
      this.#badgeEl.classList.add('visible');
      this.#hideTimer = setTimeout(() => this.#badgeEl.classList.remove('visible'), 3000);
    } else if (mode === 'realtime') {
      this.#badgeEl.textContent = 'Realtime mode — analysis server offline';
      this.#badgeEl.classList.add('visible', 'realtime');
    }
  }

  destroy() {
    clearTimeout(this.#hideTimer);
    this.#busyEl?.remove();
    this.#badgeEl?.remove();
  }
}
