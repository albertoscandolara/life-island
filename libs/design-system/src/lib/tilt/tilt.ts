import { Directive, ElementRef, inject, input } from '@angular/core';

/**
 * Turns the island tokens and 3D cards inside this element towards the
 * pointer: sets `--tilt-x`, `--tilt-y` (degrees) and `--glare-x` (a
 * percentage) while the pointer moves over it, and clears them when it
 * leaves. Only with a mouse or trackpad, and never with reduced motion, so a
 * phone and a screen reader see the same still page.
 */
@Directive({
  selector: '[uiTilt]',
  host: {
    '(pointermove)': 'move($event)',
    '(pointerleave)': 'reset()',
  },
})
export class UiTilt {
  /** The largest turn, in degrees. */
  readonly uiTilt = input(10, {
    transform: (value: number | string | undefined) =>
      value === '' || value === undefined ? 10 : Number(value),
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly enabled =
    typeof matchMedia === 'function' &&
    matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;

  protected move(event: PointerEvent): void {
    if (!this.enabled) return;
    const { x, y } = tiltFor(
      this.host.nativeElement.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    const max = this.uiTilt();
    const style = this.host.nativeElement.style;
    style.setProperty('--tilt-x', `${(-y * max).toFixed(2)}deg`);
    style.setProperty('--tilt-y', `${(x * max).toFixed(2)}deg`);
    style.setProperty('--glare-x', `${Math.round((0.5 - x) * 100)}%`);
  }

  protected reset(): void {
    const style = this.host.nativeElement.style;
    style.removeProperty('--tilt-x');
    style.removeProperty('--tilt-y');
    style.removeProperty('--glare-x');
  }
}

/** Where the pointer is on a box, from -0.5 (left, top) to 0.5 (right, bottom). */
export function tiltFor(
  box: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const clamp = (v: number) => Math.min(0.5, Math.max(-0.5, v));
  return {
    x: box.width ? clamp((clientX - box.left) / box.width - 0.5) : 0,
    y: box.height ? clamp((clientY - box.top) / box.height - 0.5) : 0,
  };
}
