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

/**
 * A y-scale that need not start at zero (a lab value, a weight): from a
 * round number below `min` to one above `max`, with 4–5 round ticks.
 */
export function niceRange(
  min: number,
  max: number,
  target = 4,
): { min: number; max: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max))
    return { min: 0, max: 1, ticks: [0, 1] };
  if (min > max) [min, max] = [max, min];
  // One value alone: a window around it, so the line sits in the middle.
  const span = max - min || Math.abs(max) * 0.2 || 1;
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ??
    10 * power;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  let bottom = Math.floor((max === min ? min - span / 2 : min) / step) * step;
  let top = Math.ceil((max === min ? max + span / 2 : max) / step) * step;
  if (top === bottom) top = bottom + step;
  bottom = round(bottom);
  top = round(top);
  const ticks: number[] = [];
  for (let t = bottom; t <= top + step / 2; t += step) ticks.push(round(t));
  return { min: bottom, max: top, ticks };
}
