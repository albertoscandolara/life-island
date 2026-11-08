/** A y-scale from 0 to a round number, with 4–5 evenly spaced round ticks. */
export function niceScale(
  max: number,
  target = 4,
): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const raw = max / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ??
    10 * power;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step)
    ticks.push(Math.round(t * 1e6) / 1e6);
  return { max: top, ticks };
}

/** Which x labels to print so they never overlap: every n-th, always the last. */
export function labelEvery(
  count: number,
  width: number,
  labelWidth: number,
): number {
  if (count <= 0 || width <= 0) return 1;
  return Math.max(1, Math.ceil((count * labelWidth) / width));
}

/** A bar from the baseline up to `top`, with 4px rounded data-end and square base. */
export function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 4,
): string {
  if (height <= 0 || width <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    'Z',
  ].join(' ');
}

/** Width the host element renders at, followed live. */
export function observeWidth(
  element: HTMLElement,
  set: (width: number) => void,
): () => void {
  set(element.clientWidth);
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const observer = new ResizeObserver(([entry]) =>
    set(entry.contentRect.width),
  );
  observer.observe(element);
  return () => observer.disconnect();
}
