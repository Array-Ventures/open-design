type Viewport = { width: number; height: number };
const limits = { width: 3840, height: 2160 };
/** Fit the public logical stage before disabling preview scaling. Custom stages
 * without logical getters retain their authored attributes/layout fallback. */
export function deckCaptureViewport(current: Viewport, stages: unknown): Viewport {
  if (!Array.isArray(stages) || stages.length > 200) throw Error('Invalid deck capture geometry.');
  const result = { ...current };
  for (const stage of stages) {
    if (!stage || typeof stage !== 'object') throw Error('Invalid deck capture geometry.');
    for (const dimension of ['width', 'height'] as const) {
      const value = stage[dimension];
      if (!value || typeof value !== 'object') throw Error('Invalid deck capture geometry.');
      const candidate = value.logical ?? (value.attribute === null ? value.layout || current[dimension] : Number(value.attribute));
      const layout = value.layout ?? 0;
      if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0 || candidate > limits[dimension] || typeof layout !== 'number' || !Number.isFinite(layout) || layout < 0 || layout > limits[dimension]) throw Error('Deck capture geometry exceeds the 3840 × 2160 export limit.');
      result[dimension] = Math.max(result[dimension], Math.ceil(candidate), Math.ceil(layout));
    }
  }
  return result;
}
/** Public custom-element properties, attributes and light-DOM layout only.
 * No private canvas, shadow tree, source mutation or selected-slide replacement. */
export const deckCaptureGeometry = (selector: string) => `(() => {
  const stages = Array.from(document.querySelectorAll('deck-stage'));
  if (stages.length > 200) throw new Error('Invalid deck capture geometry.');
  return stages.map(stage => {
    const slides = Array.from(stage.querySelectorAll(${JSON.stringify(selector)}));
    return {
      width: {logical: stage.designWidth, attribute: stage.getAttribute('width'), layout: Math.max(stage.offsetWidth, ...slides.map(slide => slide.offsetWidth))},
      height: {logical: stage.designHeight, attribute: stage.getAttribute('height'), layout: Math.max(stage.offsetHeight, ...slides.map(slide => slide.offsetHeight))}
    };
  });
})()`;

/** Responsive layout can grow when its viewport grows. Verify the fixed point
 * after each resize; refuse instead of allowing screenshot's implicit expansion. */
export async function settleDeckCaptureViewport(
  read: () => Promise<{ viewport: Viewport; stages: unknown }>,
  resize: (viewport: Viewport) => Promise<void>,
): Promise<void> {
  for (let changes = 0; ; changes++) {
    const { viewport, stages } = await read(), fitted = deckCaptureViewport(viewport, stages);
    if (fitted.width === viewport.width && fitted.height === viewport.height) return;
    if (changes === 4) throw Error('Deck capture layout did not settle within its bounded viewport.');
    await resize(fitted);
  }
}
