import {
  DREAM_AREA_LABELS,
  DREAM_FEELINGS,
  DREAM_PACE_LABELS,
  DREAM_STRETCH_LABELS,
  dreamReach,
  stretchRank,
  type DreamArea,
  type DreamCheckInDto,
  type DreamContextDto,
  type DreamDto,
  type DreamQuestionDto,
  type DreamQuestionsOutput,
  type DreamReach,
  type DreamStepDto,
  type DreamStepKind,
  type DreamStepsOutput,
  type DreamStretch,
} from '@life-island/contracts';
import { contextLines } from './context.js';

/*
 * The careful part of Dreams, as pure functions: the questions asked before
 * any step, the ladder of small steps Life Island's own rules suggest when
 * Claude is off, what Claude is told, and the dossier it reads.
 */

type DreamFields = Pick<
  DreamDto,
  | 'title'
  | 'area'
  | 'story'
  | 'why'
  | 'today'
  | 'fears'
  | 'mustKeep'
  | 'pace'
  | 'status'
>;

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

const COMMON_QUESTIONS = {
  picture: {
    question:
      'Picture an ordinary day once this dream is real. What is different from today?',
    why: 'A clear picture tells the steps where to go, and shows what you really want from it.',
  },
  fear: {
    question:
      'What is the part that scares you most, and what would make it a little smaller?',
    why: 'The first steps can shrink that fear before anything big happens.',
  },
  mustKeep: {
    question:
      'What can you not put at risk while you try: income, time, people, health?',
    why: 'Every step stays inside these limits.',
  },
  time: {
    question:
      'Honestly, how much time and energy could you give this in a usual week?',
    why: 'Steps that fit your week get done; steps that do not, weigh on you.',
  },
};

const AREA_QUESTIONS: Partial<
  Record<DreamArea, { question: string; why: string }[]>
> = {
  work: [
    {
      question:
        'What exactly is not right at work today: the work itself, the people, the pay, the growth, or the hours?',
      why: 'Knowing what is wrong tells whether the answer is another company, another role, or a change where you are.',
    },
    {
      question:
        'Is there anything you like about your job, that the next one should keep?',
      why: 'A change should not cost you what already works.',
    },
  ],
  travel: [
    {
      question:
        'Is it a trip, a long stay somewhere, or a life in another place?',
      why: 'Each one needs very different steps and money.',
    },
  ],
  fitness: [
    {
      question:
        'Is there anything about your health a doctor should look at before you start?',
      why: 'Safe steps come first; a check-up is a good one.',
    },
  ],
  learning: [
    {
      question:
        'What would you like to be able to do, once you have learnt it?',
      why: 'A skill you can use is easier to plan than a topic.',
    },
  ],
  money: [
    {
      question:
        'What would this money give you: calm, freedom, a thing, a change?',
      why: 'The reason sets how much is enough.',
    },
  ],
  home: [
    {
      question:
        'Is it a different home, a different place, or the same home made better?',
      why: 'It decides whether the first steps are about money, places or work on the house.',
    },
  ],
  relationships: [
    {
      question:
        'Who is this about, and what would you like to be different between you?',
      why: 'Steps between people are small and gentle, and they start from you.',
    },
  ],
  creativity: [
    {
      question: 'What would you love to have made, a year from now?',
      why: 'A finished thing, even small, is a better target than a feeling.',
    },
  ],
};

/** Life Island's own questions: the area's first, then those the dream does not answer yet. */
export function offlineQuestions(dream: DreamFields): DreamQuestionsOutput {
  const questions = [...(AREA_QUESTIONS[dream.area] ?? [])];
  questions.push(COMMON_QUESTIONS.picture);
  if (!dream.fears) questions.push(COMMON_QUESTIONS.fear);
  if (!dream.mustKeep) questions.push(COMMON_QUESTIONS.mustKeep);
  questions.push(COMMON_QUESTIONS.time);
  return {
    opening: `“${dream.title}”: it is worth taking seriously. Before any step, a few questions, so the plan fits your life as it is.`,
    questions: questions.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// The ladder of small steps (offline)
// ---------------------------------------------------------------------------

export interface LadderStep {
  title: string;
  kind: DreamStepKind;
  why: string;
  minutes: number;
  costEuro: number;
  cost: string;
  stretch: DreamStretch;
  undo: string;
  smaller: string;
}

const PRIVATE = 'Nothing to undo: it stays a private note.';

const step = (
  kind: DreamStepKind,
  stretch: DreamStretch,
  title: string,
  why: string,
  minutes: number,
  undo: string,
  smaller: string,
  costEuro = 0,
  cost = '',
): LadderStep => ({
  title,
  kind,
  why,
  minutes,
  costEuro,
  cost,
  stretch,
  undo,
  smaller,
});

const LADDERS: Partial<Record<DreamArea, LadderStep[]>> & {
  other: LadderStep[];
} = {
  work: [
    step(
      'reflect',
      'tiny',
      'Note for one week what drains you and what gives you energy at work',
      'It turns “I am not happy” into facts you can act on.',
      35,
      PRIVATE,
      'Write just one line tonight.',
      0,
      'Five minutes a day, for a week.',
    ),
    step(
      'reflect',
      'tiny',
      'Write the three things a better job would have that yours lacks',
      'They become the filter for every company you look at.',
      20,
      PRIVATE,
      'Write only the first one.',
    ),
    step(
      'prepare',
      'tiny',
      'Check your safety net: how many months your savings cover',
      'Knowing it makes the fear smaller, or tells you to save first.',
      15,
      'Nothing changes: you only look at numbers.',
      'Look only at your balance today.',
    ),
    step(
      'explore',
      'tiny',
      'Read five job posts in your field, without applying, and note what attracts you',
      'You see what is out there and what you are worth, with no commitment.',
      30,
      'Nobody knows you looked.',
      'Read just one.',
    ),
    step(
      'prepare',
      'small',
      'Update your CV in a file only you see',
      'When the right chance comes you are ready, without rushing.',
      60,
      'It stays in a drawer until you decide.',
      'Update only the last job.',
    ),
    step(
      'explore',
      'small',
      'Ask one person who changed job how they did it',
      'Hearing a real story makes the change feel possible, and shows its traps.',
      45,
      'It is only a conversation: you promise nothing.',
      'Send them a message, and meet later.',
    ),
    step(
      'prepare',
      'small',
      'Write the lowest salary and the conditions you would accept',
      'With your limits on paper, no offer can push you past them.',
      20,
      PRIVATE,
      'Write only the salary.',
    ),
    step(
      'try',
      'brave',
      'Apply to one role you really like, only one',
      'You learn how it feels and what they ask, while nothing changes at your job.',
      60,
      'Applying commits you to nothing: you can withdraw, or say no to any offer.',
      'Save the post and write the cover letter, without sending it.',
    ),
    step(
      'try',
      'brave',
      'Go to one interview, and treat it as practice',
      'Each interview makes the next one easier, and tells you about the company.',
      90,
      'An interview is not a yes: you decide after.',
      'Do a practice interview with a friend first.',
      0,
      'An hour or two, maybe a half day off.',
    ),
  ],
  travel: [
    step(
      'reflect',
      'tiny',
      'Write what you want from this trip: rest, adventure, people, a place',
      'It tells which trip is really the one.',
      15,
      PRIVATE,
      'Write one word.',
    ),
    step(
      'explore',
      'tiny',
      'Collect three places that match it, and what a week there costs',
      'A dream with a price is a plan you can save for.',
      40,
      'Nothing is booked.',
      'Look at one place only.',
    ),
    step(
      'prepare',
      'tiny',
      'Check your documents: passport and ID dates',
      'An expired passport ends a trip before it starts.',
      10,
      'Nothing to undo.',
      'Look at the passport only.',
    ),
    step(
      'prepare',
      'small',
      'Put aside a small amount each month in a trip pot',
      'Saving makes the trip real, a little at a time.',
      15,
      'You can move the money back any time.',
      'Put aside €10 this month.',
      0,
      'A small amount a month, that stays yours.',
    ),
    step(
      'try',
      'small',
      'Pick dates and ask for the time off, provisionally',
      'Dates turn “one day” into a plan.',
      20,
      'A provisional request can be moved or withdrawn.',
      'Only look at which weeks could work.',
    ),
    step(
      'try',
      'brave',
      'Book the first piece, with free cancellation',
      'Once something is booked, the trip starts.',
      30,
      'Pick a booking you can cancel for free.',
      'Book only the first night.',
      0,
      'A deposit, refundable.',
    ),
  ],
  fitness: [
    step(
      'reflect',
      'tiny',
      'Write why this matters to you, and what you can do today',
      'Starting from where you are keeps you safe and motivated.',
      15,
      PRIVATE,
      'Write one sentence.',
    ),
    step(
      'prepare',
      'tiny',
      'Book a check-up if you have not had one in a while',
      'Safe steps come first.',
      15,
      'An appointment can be moved.',
      'Look up when your last check-up was.',
    ),
    step(
      'try',
      'tiny',
      'Walk 15 minutes, three days this week',
      'A habit that fits the week beats a big start that stops.',
      45,
      'Nothing to undo.',
      'Walk 10 minutes once.',
      0,
      'Three short walks.',
    ),
    step(
      'explore',
      'small',
      'Try one class or one session of the sport you dream of',
      'You find out if you like it before buying anything.',
      60,
      'One session commits you to nothing.',
      'Watch one session, without joining.',
      15,
      'One session, often €10 to €20.',
    ),
    step(
      'try',
      'small',
      'Pick a gentle plan for four weeks, in Fitness',
      'A plan makes the next session obvious.',
      20,
      'You can change it or stop any time.',
      'Plan only next week.',
    ),
    step(
      'try',
      'brave',
      'Sign up for an event a few months away, with a refundable entry',
      'A date gives your training a reason.',
      20,
      'Choose an entry you can refund or transfer.',
      'Only pick the event, without signing up.',
      30,
      'An entry fee, refundable.',
    ),
  ],
  learning: [
    step(
      'reflect',
      'tiny',
      'Write what you would like to be able to do once you have learnt it',
      'A skill you can use is easier to plan than a topic.',
      15,
      PRIVATE,
      'Write one example.',
    ),
    step(
      'explore',
      'tiny',
      'Find two free introductions and try 20 minutes of one',
      'You feel if it is for you before paying anything.',
      30,
      'Nothing to undo.',
      'Watch 5 minutes.',
    ),
    step(
      'prepare',
      'small',
      'Pick a learning path in Studies, or write your own three steps',
      'A path tells you what comes next.',
      30,
      'You can pause or change it any time.',
      'Pick only the first step.',
    ),
    step(
      'try',
      'small',
      'Block two short sessions a week in your calendar',
      'Time on the calendar is time that happens.',
      10,
      'Move or delete them any time.',
      'Block one session.',
    ),
    step(
      'try',
      'brave',
      'Make one small thing with what you learnt, and show it to someone',
      'Using it is how it sticks, and it shows you how far you came.',
      120,
      'Show it only to someone you trust.',
      'Make it, and keep it for yourself.',
    ),
  ],
  money: [
    step(
      'reflect',
      'tiny',
      'Write what this money would give you, and how much is enough',
      'A clear amount stops the target from running away.',
      15,
      PRIVATE,
      'Write only the amount.',
    ),
    step(
      'prepare',
      'tiny',
      'Look at where your money went last month, in Money',
      'You find what you can change without giving up what you love.',
      20,
      'Nothing changes: you only look.',
      'Look at one category.',
    ),
    step(
      'try',
      'small',
      'Cancel or pause one subscription you do not use',
      'Small savings repeat every month.',
      15,
      'Most subscriptions can be started again.',
      'Write the list, and cancel later.',
    ),
    step(
      'try',
      'small',
      'Move a small fixed amount to savings on payday',
      'Saving first makes it automatic.',
      15,
      'You can stop or move it back any time.',
      'Move €10 once.',
    ),
  ],
  other: [
    step(
      'reflect',
      'tiny',
      'Describe one ordinary day once this dream is real',
      'A clear picture shows what you really want from it.',
      15,
      PRIVATE,
      'Write three lines.',
    ),
    step(
      'reflect',
      'tiny',
      'Write the smallest version of this dream you could try in a month',
      'A small version lets you taste it with nothing at risk.',
      15,
      PRIVATE,
      'Think about it on a walk.',
    ),
    step(
      'explore',
      'tiny',
      'Find one person who lives this already, and read or listen to their story',
      'Real stories show the way, and the traps.',
      30,
      'Nothing to undo.',
      'Read one short piece.',
    ),
    step(
      'explore',
      'small',
      'Talk about it with one person you trust',
      'Saying it aloud makes it real, and they may help.',
      30,
      'It is only a conversation.',
      'Write them a message first.',
    ),
    step(
      'prepare',
      'small',
      'Set aside a little time or money for it each week',
      'A dream gets closer when it has a place in your week.',
      15,
      'You can stop any time.',
      'Set aside one hour, once.',
    ),
    step(
      'try',
      'brave',
      'Try the small version once',
      'You learn more from one try than from a month of thinking.',
      120,
      'One try commits you to nothing.',
      'Plan the try, and do it later.',
    ),
  ],
};

export function ladderFor(area: DreamArea): LadderStep[] {
  return LADDERS[area] ?? LADDERS.other;
}

const sameTitle = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Life Island's own next steps: the ladder's next rungs within reach, ones you skipped made smaller. */
export function offlineSteps(
  dream: DreamFields,
  steps: readonly Pick<DreamStepDto, 'title' | 'status'>[],
  reach: DreamReach,
  safetyNet: { runwayMonths: number | null } | null,
): DreamStepsOutput {
  const ladder = ladderFor(dream.area);
  const fresh = ladder.filter(
    (rung) =>
      stretchRank(rung.stretch) <= stretchRank(reach.maxStretch) &&
      !steps.some((s) => sameTitle(s.title, rung.title)),
  );
  // A rung you skipped comes back as its smaller version, once.
  const skipped = ladder
    .filter((rung) =>
      steps.some(
        (s) => s.status === 'skipped' && sameTitle(s.title, rung.title),
      ),
    )
    .filter((rung) => !steps.some((s) => sameTitle(s.title, rung.smaller)))
    .map((rung): LadderStep => ({
      ...rung,
      title: rung.smaller,
      stretch: 'tiny',
      minutes: Math.max(5, Math.round(rung.minutes / 3)),
      cost: 'A few minutes.',
      why: `A smaller way into “${rung.title.toLowerCase()}”, which you set aside.`,
      smaller: 'Only think about it, and come back when you feel like it.',
    }));
  const done = steps.filter((s) => s.status === 'done').length;
  const picked = [...skipped, ...fresh].slice(0, reach.count);
  return {
    reflection: !done
      ? `This is the beginning: the first steps are about understanding, not changing anything yet. ${reach.reason}`
      : `You already took ${done} step${done === 1 ? '' : 's'}. ${reach.reason}`,
    steps: picked,
    notYet: notYetMoves(dream.area, safetyNet),
    care: reach.heavy
      ? 'These steps seem to weigh on you. It is fine to rest, or stay on the same step for a while. If things feel heavy beyond this dream, talking to someone you trust, or to a professional, can really help.'
      : null,
  };
}

function notYetMoves(
  area: DreamArea,
  safetyNet: { runwayMonths: number | null } | null,
): DreamStepsOutput['notYet'] {
  const runway =
    safetyNet?.runwayMonths !== null && safetyNet?.runwayMonths !== undefined
      ? ` Today your savings cover about ${safetyNet.runwayMonths} months.`
      : '';
  if (area === 'work')
    return [
      {
        move: 'Resigning',
        when: `Only with a signed offer you really want, or at least six months of safety net and a plan for them.${runway}`,
      },
    ];
  if (area === 'home')
    return [
      {
        move: 'Buying, selling or signing a lease',
        when: `Once you have seen the places, know the full costs, and the deposit does not touch your safety net.${runway}`,
      },
    ];
  if (area === 'travel')
    return [
      {
        move: 'Paying for things you cannot cancel',
        when: 'Once the dates and the time off are certain.',
      },
    ];
  return [];
}

// ---------------------------------------------------------------------------
// What Claude is told
// ---------------------------------------------------------------------------

export const QUESTIONS_INSTRUCTIONS = `You are Ovi, a calm, careful guide inside Life Island, an app one person uses to run their life. They wrote down a dream: something they would love to reach but that scares them a little, because it means leaving their comfort zone.

Before any step is planned, you ask the few questions that help plan it well. Write:
- opening: one or two warm sentences that say their dream back in their own words, so they feel heard. No praise, no hype.
- questions: three to five open questions, the most important first, each with why it helps. Cover what you do not know yet: what is wrong today, what scares them most, what they cannot put at risk (income, time, people, health), how much time and energy they have in a usual week, and what "reached" would look like. Skip what they already wrote.

Rules: one idea per question, plain and kind words, no jargon, no emojis, no therapy talk, no pressure. Write in the language the dream is written in.`;

export const STEPS_INSTRUCTIONS = `You are Ovi, a calm, careful guide inside Life Island. One person wants to reach a dream but finds it hard to leave their comfort zone without a plan. Your job is to suggest the next few small, reversible steps, and nothing more. They decide; you never push.

You receive the dream in their words (why, where they are today, fears, what they must keep), their answers to your questions, the steps they took or set aside, how each step felt (1 too much ... 5 energising) and the pace they asked for next, the furthest stretch allowed now, and, only if they chose to share them, a few facts from other areas of their life (savings and the months they cover, time at their job, studies, fitness, travel, goals).

Write:
- reflection: two or three honest, kind sentences on where the dream stands and what the next steps are for.
- steps: as many steps as asked (two to four), the first the easiest. Each is concrete, verb first, doable in one sitting or one week, with: kind (reflect, explore, prepare, try, decide), why, minutes, costEuro (0 when free), cost (what else it asks of you, such as energy or a day off; empty when minutes and money say it all), stretch no further than allowed, undo (how to undo it; every step must be reversible or private), and a smaller version for a day it feels too much.
- notYet: up to three bigger moves that are not for now (resigning, moving, large purchases or commitments, ending something), each with what should be true first, using the facts given (for example the months of safety net).
- care: null, unless the check-ins or answers sound heavy (fear, exhaustion, feeling low). Then a gentle note: slowing down or resting is fine, and if it feels heavy beyond this dream, talking to someone they trust or to a professional can help. Never diagnose.

Rules:
- Never suggest an irreversible or risky move as a step: it goes in notYet with its condition.
- Stay inside what they must keep. Never assume money or time they did not mention.
- Do not repeat a step they did or set aside. After a skipped step or a hard check-in, offer something smaller or different, never the same thing again.
- Use only what is given; never invent facts about them. If a fact would help and is missing, a step can be to find it out.
- Plain, warm words; no "you should", no jargon, no emojis, no hype. Write in the language the dream is written in.`;

export function questionsDossier(dream: DreamFields): string {
  return ['<dream>', ...dreamLines(dream), '</dream>'].join('\n');
}

function dreamLines(dream: DreamFields): string[] {
  const lines = [
    `Dream: ${dream.title}`,
    `Area of life: ${DREAM_AREA_LABELS[dream.area]}`,
  ];
  const add = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`);
  };
  add('In their words', dream.story);
  add('Why it matters', dream.why);
  add('Where they are today', dream.today);
  add('What scares them', dream.fears);
  add('What they cannot put at risk', dream.mustKeep);
  return lines;
}

export function stepsDossier(
  today: string,
  dream: DreamFields,
  questions: readonly DreamQuestionDto[],
  steps: readonly DreamStepDto[],
  checkIns: readonly DreamCheckInDto[],
  reach: DreamReach,
  context: DreamContextDto | null,
  note: string | null,
): string {
  const lines = [`Today is ${today}.`, '<dream>', ...dreamLines(dream)];
  lines.push(`Pace they chose: ${DREAM_PACE_LABELS[dream.pace]}`, '</dream>');
  const answered = questions.filter((q) => q.answer);
  if (answered.length) {
    lines.push('<answers>');
    for (const q of answered)
      lines.push(`- Q: ${q.question}`, `  A: ${q.answer!.slice(0, 800)}`);
    lines.push('</answers>');
  }
  const taken = steps.filter((s) => s.status !== 'suggested');
  if (taken.length) {
    lines.push('<steps>');
    for (const s of taken.slice(0, 20))
      lines.push(
        `- [${s.status === 'dismissed' ? 'not for me' : s.status}] ${s.title} (${DREAM_STRETCH_LABELS[s.stretch].toLowerCase()})`,
      );
    lines.push('</steps>');
  }
  if (checkIns.length) {
    lines.push('<check-ins newest first>');
    for (const c of checkIns.slice(0, 6)) {
      const feeling = DREAM_FEELINGS.find((f) => f.value === c.feeling);
      lines.push(
        `- ${c.createdAt.slice(0, 10)}${c.stepTitle ? `, after “${c.stepTitle}” (${c.outcome ?? 'no outcome'})` : ''}: felt ${c.feeling}/5 (${feeling?.label ?? ''}); next: ${c.nextPace}${c.note ? `; they wrote: ${c.note.slice(0, 500)}` : ''}`,
      );
    }
    lines.push('</check-ins>');
  }
  const facts = context ? contextLines(context) : [];
  if (facts.length)
    lines.push('<their life, shared by them>', ...facts, '</their life>');
  lines.push(
    `Suggest ${reach.count} steps. Furthest stretch allowed now: ${reach.maxStretch} (${DREAM_STRETCH_LABELS[reach.maxStretch]}). ${reach.reason}`,
  );
  if (reach.heavy)
    lines.push('The last two check-ins felt heavy: write the care note.');
  if (note) lines.push(`They add: ${note}`);
  return lines.join('\n');
}

/** The pace of a dream from its check-ins, newest first. */
export function reachOf(
  dream: Pick<DreamFields, 'pace'>,
  checkIns: readonly Pick<DreamCheckInDto, 'feeling' | 'nextPace'>[],
): DreamReach {
  return dreamReach(dream.pace, checkIns);
}

/** Keeps a model's steps within the reach, whatever it wrote. */
export function clampSteps(
  output: DreamStepsOutput,
  reach: DreamReach,
): DreamStepsOutput {
  const max = stretchRank(reach.maxStretch);
  return {
    ...output,
    steps: output.steps.slice(0, 4).map((s) => ({
      ...s,
      stretch: stretchRank(s.stretch) > max ? reach.maxStretch : s.stretch,
      minutes: Math.max(0, Math.round(s.minutes)),
      costEuro: Math.max(0, Math.round(s.costEuro * 100) / 100),
    })),
    notYet: output.notYet.slice(0, 3),
  };
}
