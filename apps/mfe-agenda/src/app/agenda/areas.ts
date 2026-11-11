import { DEADLINE_SOURCES } from '@life-island/contracts';

/** How each area is named and shown on an agenda line. */
export const AREAS: Record<string, { name: string; emblem: string }> = {
  ...Object.fromEntries(
    DEADLINE_SOURCES.map((s) => [s.module, { name: s.name, emblem: s.emblem }]),
  ),
  agenda: { name: 'My items', emblem: '🗓️' },
  taxes: { name: '730 & taxes', emblem: '🦖' },
};

export function areaOf(module: string): { name: string; emblem: string } {
  return AREAS[module] ?? { name: module, emblem: '•' };
}
