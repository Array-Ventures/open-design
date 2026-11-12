/** Retain the last rendered canvas while its replacement initializes. Retired
 * kernels cannot receive input and are disposed only after the replacement is
 * ready, or immediately when the whole surface closes. No bitmap substitutes. */
export class WorkbookViewLayers {
  private layers = new Set<{ element: HTMLDivElement; dispose(): void }>();
  private shown: HTMLDivElement | null = null;
  closed = false;
  constructor(readonly host: HTMLDivElement) {}

  begin() {
    const element = document.createElement('div');
    element.className = 'absolute inset-0';
    const replacing = this.shown !== null;
    // The pinned document input must initialize outside inert. Hidden CSS
    // already prevents pointer/focus access until the layer is revealed.
    if (replacing) element.style.visibility = 'hidden';
    this.host.appendChild(element);
    this.host.setAttribute('aria-busy', 'true');
    let owned = () => {}, disposed = false;
    const layer = { element, dispose: () => {
      if (disposed) return;
      disposed = true;
      try { owned(); } finally { element.remove(); this.layers.delete(layer); }
    } };
    this.layers.add(layer);
    return {
      element,
      own: (dispose: () => void) => { owned = dispose; },
      show: () => {
        if (this.closed || disposed) return;
        this.shown = element;
        element.style.visibility = ''; element.inert = false;
        element.removeAttribute('aria-hidden');
        this.host.removeAttribute('aria-busy');
        for (const previous of [...this.layers]) if (previous !== layer) previous.dispose();
      },
      retire: () => {
        element.inert = true; element.setAttribute('aria-hidden', 'true');
        if (this.closed || this.shown !== element) layer.dispose();
      },
    };
  }

  dispose() {
    this.closed = true;
    for (const layer of [...this.layers]) layer.dispose();
    this.shown = null;
    this.host.removeAttribute('aria-busy');
  }
}
