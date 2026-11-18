import {
  AGENDA_CATEGORY_LABELS,
  AGENDA_REPEAT_LABELS,
  GROCERY_CATEGORY_LABELS,
  INTENSITY_LABELS,
  WORKOUT_KIND_LABELS,
} from '@life-island/contracts';
import { localToday } from './format';
import { liOptions, type LiField } from './record-dialog';

/*
 * The forms of the records you add most often, shared by the area that keeps
 * them and by the island's "Add" menu, so a reminder added from the top bar
 * asks the same questions as one added in the Agenda.
 */

/** One of your own Agenda items: a reminder, a birthday, a call to make. */
export const AGENDA_ITEM_FIELDS: readonly LiField[] = [
  {
    key: 'title',
    label: 'What',
    type: 'text',
    required: true,
    wide: true,
    placeholder: 'Call the plumber, Anna’s birthday…',
  },
  { key: 'date', label: 'Date', type: 'date', required: true },
  { key: 'time', label: 'Time', type: 'time', hint: 'Optional' },
  {
    key: 'repeat',
    label: 'Repeats',
    type: 'select',
    required: true,
    options: liOptions(AGENDA_REPEAT_LABELS),
  },
  {
    key: 'category',
    label: 'Kind',
    type: 'select',
    required: true,
    options: liOptions(AGENDA_CATEGORY_LABELS),
  },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

/** A workout in Fitness. */
export const WORKOUT_FIELDS: readonly LiField[] = [
  { key: 'date', label: 'Date', type: 'date', required: true },
  {
    key: 'kind',
    label: 'What',
    type: 'select',
    required: true,
    options: liOptions(WORKOUT_KIND_LABELS),
  },
  {
    key: 'minutes',
    label: 'Minutes',
    type: 'number',
    required: true,
    min: 1,
    max: 1440,
  },
  {
    key: 'intensity',
    label: 'How hard',
    type: 'select',
    required: true,
    options: liOptions(INTENSITY_LABELS),
    hint: 'Moderate: you can talk, not sing. Hard: only a few words.',
  },
  { key: 'distanceKm', label: 'Distance (km)', type: 'number', min: 0 },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

/** A day's body numbers in Fitness: weight, waist, heart rate, sleep, steps. */
export const MEASUREMENT_FIELDS: readonly LiField[] = [
  { key: 'date', label: 'Date', type: 'date', required: true },
  { key: 'weightKg', label: 'Weight (kg)', type: 'number', min: 1, max: 400 },
  { key: 'waistCm', label: 'Waist (cm)', type: 'number', min: 10, max: 300 },
  {
    key: 'restingHr',
    label: 'Resting heart rate',
    type: 'number',
    min: 20,
    max: 220,
  },
  {
    key: 'sleepHours',
    label: 'Sleep (hours)',
    type: 'number',
    min: 0,
    max: 24,
  },
  { key: 'steps', label: 'Steps', type: 'number', min: 0 },
];

/** A line of the Groceries shopping list. */
export const SHOPPING_ITEM_FIELDS: readonly LiField[] = [
  { key: 'name', label: 'Item', type: 'text', required: true },
  {
    key: 'quantity',
    label: 'How much',
    type: 'text',
    placeholder: '2 packs, 1 kg…',
  },
  {
    key: 'category',
    label: 'Aisle',
    type: 'select',
    required: true,
    options: liOptions(GROCERY_CATEGORY_LABELS),
  },
  { key: 'done', label: 'In the cart', type: 'checkbox' },
];

export type QuickAddId = 'reminder' | 'workout' | 'body' | 'shopping';

/** Something the island's "Add" menu adds without opening its area. */
export interface QuickAddKind {
  id: QuickAddId;
  /** The menu line: "A reminder". */
  label: string;
  /** The form's heading, after "Add ": "Reminder". */
  heading: string;
  /** The area that keeps it (an ISLAND_MODULES id) and its emblem. */
  area: string;
  emblem: string;
  /** The area's API through the gateway, and the collection it is added to. */
  base: string;
  collection: string;
  service: string;
  fields: readonly LiField[];
  /** A new one's values; `text` is what you typed in search, if anything. */
  defaults: (text?: string) => Record<string, unknown>;
  /** The field `text` fills. */
  textKey: string | null;
  /** Where you see it once added. */
  path: string;
}

export const QUICK_ADD_KINDS: readonly QuickAddKind[] = [
  {
    id: 'reminder',
    label: 'A reminder',
    heading: 'Reminder',
    area: 'agenda',
    emblem: '🗓️',
    base: '/api/agenda',
    collection: 'items',
    service: 'svc-agenda',
    fields: AGENDA_ITEM_FIELDS,
    defaults: (text) => ({
      title: text ?? '',
      date: localToday(),
      repeat: 'none',
      category: 'personal',
    }),
    textKey: 'title',
    path: '/agenda?tab=items',
  },
  {
    id: 'shopping',
    label: 'Something to buy',
    heading: 'Item',
    area: 'groceries',
    emblem: '🛒',
    base: '/api/groceries',
    collection: 'list',
    service: 'svc-groceries',
    fields: SHOPPING_ITEM_FIELDS,
    defaults: (text) => ({ name: text ?? '', category: 'other' }),
    textKey: 'name',
    path: '/groceries',
  },
  {
    id: 'workout',
    label: 'A workout',
    heading: 'Workout',
    area: 'fitness',
    emblem: '🏃',
    base: '/api/fitness',
    collection: 'workouts',
    service: 'svc-fitness',
    fields: WORKOUT_FIELDS,
    defaults: () => ({
      date: localToday(),
      kind: 'walk',
      intensity: 'moderate',
      minutes: 30,
    }),
    textKey: null,
    path: '/fitness',
  },
  {
    id: 'body',
    label: 'Your weight or sleep',
    heading: 'Measurement',
    area: 'fitness',
    emblem: '⚖️',
    base: '/api/fitness',
    collection: 'measurements',
    service: 'svc-fitness',
    fields: MEASUREMENT_FIELDS,
    defaults: () => ({ date: localToday() }),
    textKey: null,
    path: '/fitness?tab=body',
  },
];
