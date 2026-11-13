/** A completed touch must not refocus its original editor through Chromium's
 * compatibility mousedown/click. Normal taps never install this local guard. */
export function guardLongPressCompletion(boundary: HTMLElement, target: Node, point: { x: number; y: number }, pointerId: number) {
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false, mouseStarted = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; clearTimeout(timer);
    boundary.removeEventListener('pointerdown', dispose, true);
    boundary.removeEventListener('mousedown', mouseDown, true);
    boundary.removeEventListener('click', click, true);
  };
  const matches = (event: MouseEvent) => !disposed && target.isConnected && boundary.contains(target)
    && event.target instanceof Node && target.contains(event.target) && event.button === 0 && event.detail > 0
    && Math.hypot(event.clientX - point.x, event.clientY - point.y) <= 8;
  const mouseDown = (event: MouseEvent) => {
    if (!matches(event)) return;
    mouseStarted = true; event.preventDefault();
  };
  const click = (event: MouseEvent) => {
    if (mouseStarted && matches(event)) event.preventDefault();
    dispose();
  };
  boundary.addEventListener('pointerdown', dispose, true);
  boundary.addEventListener('mousedown', mouseDown, true);
  boundary.addEventListener('click', click, true);
  return {
    dispose,
    release(releasedPointerId: number) {
      if (disposed || releasedPointerId !== pointerId) return;
      // Match the pinned React Aria useLongPress cleanup window. A new native
      // pointer gesture also disposes the guard before its mousedown occurs.
      clearTimeout(timer); timer = setTimeout(dispose, 100);
    },
  };
}
