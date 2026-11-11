import {
  BOOKING_KIND_LABELS,
  isoDaysBetween,
  type TripDto,
  type TripPlanOutput,
} from '@life-island/contracts';

/*
 * The planner's own rules: what everybody should do before a trip, what to
 * pack for its length, and a loose plan per day.
 */

export function offlinePlan(trip: TripDto): TripPlanOutput {
  const nights = trip.nights ?? 3;
  const kinds = new Set(trip.bookings.map((b) => b.kind));
  const checklist: TripPlanOutput['checklist'] = [
    ...(trip.abroad
      ? [
          {
            text: 'Check that passports or ID cards are valid for the whole trip (often 6 months after return)',
            daysBefore: 60,
          },
          {
            text: 'Check whether a visa or entry authorisation is needed (viaggiaresicuri.it)',
            daysBefore: 45,
          },
          {
            text: 'Get travel health insurance and check what your card covers abroad',
            daysBefore: 21,
          },
        ]
      : [
          {
            text: 'Check that ID cards and driving licences are valid',
            daysBefore: 21,
          },
        ]),
    ...(kinds.has('stay')
      ? []
      : [{ text: 'Book where to stay', daysBefore: 30 }]),
    ...(kinds.has('flight') || kinds.has('train')
      ? []
      : [{ text: 'Book how to get there', daysBefore: 30 }]),
    {
      text: 'Tell your bank if you will pay abroad, and bring a second card',
      daysBefore: 7,
    },
    {
      text: 'Download tickets, boarding passes and offline maps',
      daysBefore: 2,
    },
    { text: 'Check in online', daysBefore: 1 },
  ];
  const packing = [
    'ID card or passport',
    'Bank cards and some cash',
    'Phone charger and power bank',
    ...(trip.abroad
      ? ['Travel adapter', 'European health insurance card (TEAM)']
      : ['Tessera sanitaria']),
    'Medicines you take',
    `Clothes for ${Math.min(nights + 1, 7)} days`,
    'Toiletries',
    'Sunglasses and a light jacket',
  ];
  return {
    summary: `${trip.title}: ${nights} night${nights === 1 ? '' : 's'} in ${trip.destination}. These are the usual steps; add what your trip needs.`,
    checklist,
    packing,
    days: Array.from({ length: Math.min(nights + 1, 14) }, (_, i) => ({
      day: `Day ${i + 1}`,
      plan:
        i === 0
          ? 'Arrive, settle in and walk around the area.'
          : i === nights
            ? 'Pack, check out and travel back.'
            : 'Free day: pick one thing you really want to see.',
    })),
    budgetTips: [
      'Book trains and flights early, and compare the total with luggage.',
      'Eat one main meal a day where locals eat, away from the main sights.',
      'Look for city cards that include transport and museums.',
    ],
  };
}

export const PLANNER_INSTRUCTIONS = `You help one person from Italy prepare a trip with Life Island.

You receive the trip (destination, dates, nights, travellers, budget, whether it is outside Schengen), what is already booked, the checklist they already have, and optionally a question. Write:
- summary: two sentences about the trip and what to watch (season, documents, a busy period).
- checklist: up to twelve things to do before leaving, verb first, each with how many days before departure. Skip what is already booked or already on their checklist. Include documents and visas for trips outside Schengen.
- packing: up to twenty things to pack for this destination, season and length.
- days: a loose plan per day (at most fourteen), realistic, not packed.
- budgetTips: up to three concrete ways to spend less there.

Rules: do not invent bookings, prices or opening hours; keep advice general where you are not sure. Plain English, no emojis.`;

export function planDossier(trip: TripDto, today: string): string {
  return [
    `Today is ${today}.`,
    `Trip: ${trip.title} to ${trip.destination}${trip.abroad ? ' (outside Schengen)' : ''}.`,
    `Dates: ${trip.startOn ?? 'not set'} to ${trip.endOn ?? 'not set'}${trip.nights ? `, ${trip.nights} nights` : ''}${trip.startOn ? `, ${isoDaysBetween(today, trip.startOn)} days from now` : ''}.`,
    `Travellers: ${trip.travellers}. Budget: ${trip.budget ? `€${trip.budget}` : 'not set'}.`,
    'Booked:',
    ...trip.bookings.map(
      (b) =>
        `- ${BOOKING_KIND_LABELS[b.kind]}: ${b.title}${b.date ? ` on ${b.date}` : ''}`,
    ),
    'Already on the checklist:',
    ...trip.checklist.map((c) => `- ${c.text}${c.done ? ' (done)' : ''}`),
  ].join('\n');
}
