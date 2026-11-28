/*
 * The learning paths of Studies: a curated, beginner-level road for each
 * area you want to grow in. A path is a few stages; a stage is a few steps
 * (learn, build, practice) with the resources to use and what you can do once
 * it is done. Your progress on each step is kept by svc-studies; the paths
 * themselves are code, so every resource is reviewed in a pull request.
 *
 * Resources link only to official documentation, the authors' own sites or
 * well-known free courses. A resource without a link is a book or an
 * exercise.
 */

export const STUDY_TOPICS = [
  'ai',
  'ai-internals',
  'frameworks',
  'infrastructure',
  'leadership',
  '3d',
  'finance',
  'other',
] as const;
export type StudyTopic = (typeof STUDY_TOPICS)[number];

export const STUDY_TOPIC_LABELS: Record<StudyTopic, string> = {
  ai: 'AI engineering',
  'ai-internals': 'AI internals',
  frameworks: 'Frameworks',
  infrastructure: 'Infrastructure',
  leadership: 'Leadership',
  '3d': '3D',
  finance: 'Finance',
  other: 'Other',
};

/** What a step asks of you: read or watch, make something, or do it for real. */
export type StepKind = 'learn' | 'build' | 'practice';

export const STEP_KIND_LABELS: Record<StepKind, string> = {
  learn: 'Learn',
  build: 'Build',
  practice: 'Practice',
};

export interface PathResource {
  label: string;
  /** null for a book or an exercise with nothing to open. */
  url: string | null;
  free: boolean;
}

export interface PathStep {
  /** `<path>.<stage>.<step>`, stable: it keys your progress. */
  id: string;
  title: string;
  kind: StepKind;
  /** Hours a beginner needs, roughly. */
  hours: number;
  detail: string;
  /** What you can do once it is done. */
  outcome: string;
  resources: readonly PathResource[];
}

/**
 * The four levels a path climbs, from knowing the words to teaching others.
 * Each stage sits at one level and ends with a checkpoint: a proof you can
 * show that you reached it.
 */
export const PATH_LEVELS = [
  'foundations',
  'working',
  'professional',
  'expert',
] as const;
export type PathLevel = (typeof PATH_LEVELS)[number];

export const PATH_LEVEL_LABELS: Record<PathLevel, string> = {
  foundations: 'Foundations',
  working: 'Working',
  professional: 'Professional',
  expert: 'Expert',
};

export const PATH_LEVEL_HINTS: Record<PathLevel, string> = {
  foundations: 'You know the words and can follow along.',
  working: 'You do it on your own, on real work.',
  professional: 'Others rely on you for it.',
  expert: 'You shape how others do it, and teach it.',
};

export interface PathStage {
  id: string;
  title: string;
  goal: string;
  /** Where the stage takes you, Foundations to Expert. */
  level?: PathLevel;
  /** How you know you got there: a proof you can show. */
  checkpoint?: string;
  steps: readonly PathStep[];
}

export interface LearningPath {
  id: string;
  topic: StudyTopic;
  emblem: string;
  name: string;
  /** One line, for the card. */
  summary: string;
  /** Why this path, for you. */
  why: string;
  /** The curated templates start at beginner level; a path of yours may not say. */
  level?: 'beginner';
  stages: readonly PathStage[];
  /** The project that proves the path, built along the way. */
  capstone: string;
  /** Certifications that fit at the end, if any. */
  certifications: readonly string[];
}

const r = (label: string, url: string | null, free = true): PathResource => ({
  label,
  url,
  free,
});

export const LEARNING_PATHS: readonly LearningPath[] = [
  // ------------------------------------------------------- AI, applied
  {
    id: 'ai-coding',
    topic: 'ai',
    emblem: '✨',
    name: 'Agentic engineering',
    summary:
      'Ship real software with AI: coding agents, model APIs, tools, skills and MCP, agentic architectures, then testing, security and cost in production.',
    why: 'This is your edge as a developer in the AI wave: use agents better than anyone around you, build agentic features that hold up in production, and lead your team doing it. The theory behind it lives in its own path, How AI works, inside out.',
    level: 'beginner',
    capstone:
      'An agentic feature for Life Island built end to end: an MCP server over one module, a skill and a subagent that use it, an eval suite with traces, and a security review of its data flow.',
    certifications: [
      'Anthropic Academy course certificates (Claude Code in Action, Building with the Claude API, Introduction to MCP)',
    ],
    stages: [
      {
        id: 'foundations',
        title: 'Working with AI well',
        goal: 'Ask clearly, pick the right model and judge what comes back.',
        level: 'foundations',
        checkpoint:
          'Three vague prompts from your real work rewritten so each gives the same right answer five times in a row.',
        steps: [
          {
            id: 'ai-coding.foundations.ai-fluency',
            title: 'AI Fluency: working with AI well',
            kind: 'learn',
            hours: 3,
            detail:
              'A short course on delegating to AI, describing a task clearly, judging what comes back and using it responsibly.',
            outcome: 'A habit of checking every answer before you rely on it.',
            resources: [
              r(
                'Anthropic Academy, AI Fluency',
                'https://anthropic.skilljar.com/',
              ),
            ],
          },
          {
            id: 'ai-coding.foundations.prompting',
            title: 'Prompt engineering',
            kind: 'practice',
            hours: 6,
            detail:
              'Clear instructions, examples, XML tags to separate data from instructions, asking for a format, letting the model think before answering. Do the exercises, do not only read them.',
            outcome:
              'You can turn a vague prompt into one that works every time.',
            resources: [
              r(
                "Anthropic's interactive prompt engineering tutorial",
                'https://github.com/anthropics/prompt-eng-interactive-tutorial',
              ),
              r(
                'Claude docs, Prompt engineering overview',
                'https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/overview',
              ),
            ],
          },
          {
            id: 'ai-coding.foundations.models',
            title: 'Pick the model for the job',
            kind: 'practice',
            hours: 2,
            detail:
              'Quality, speed and price pull in different directions. Run the same task on a small, a mid and a frontier model, compare answer, latency and cost, and learn when the small one is enough.',
            outcome:
              'You choose a model with numbers, not by habit, and can defend the choice.',
            resources: [
              r(
                'Claude docs, Models overview',
                'https://docs.claude.com/en/docs/about-claude/models/overview',
              ),
              r(
                'Artificial Analysis (independent model comparisons)',
                'https://artificialanalysis.ai/',
              ),
            ],
          },
        ],
      },
      {
        id: 'daily',
        title: 'Coding agents every day',
        goal: 'Make a coding agent part of your day, and keep the quality bar yours.',
        level: 'working',
        checkpoint:
          'A week of real tickets done with an agent, every diff reviewed and merged by you.',
        steps: [
          {
            id: 'ai-coding.daily.claude-code',
            title: 'Claude Code from zero',
            kind: 'learn',
            hours: 4,
            detail:
              'Install it, run it on this repository, ask it to explain a module, then to make a small change. Learn plan mode, CLAUDE.md, permissions and how to undo.',
            outcome:
              'You can hand a small, clear task to an agent and review its diff.',
            resources: [
              r(
                'Anthropic Academy, Claude Code in Action',
                'https://anthropic.skilljar.com/',
              ),
              r('Claude Code docs', 'https://code.claude.com/docs'),
            ],
          },
          {
            id: 'ai-coding.daily.review',
            title: 'Review what the agent wrote',
            kind: 'practice',
            hours: 4,
            detail:
              'Tests are the guardrail: ask for the test first, run it, read every line of the diff. Spot the usual mistakes: invented APIs, swallowed errors, code that passes the test but not the intent.',
            outcome:
              'You never merge AI code you could not explain in a code review.',
            resources: [
              r(
                'Exercise: take one PR an agent opened on Life Island and review it line by line',
                null,
              ),
            ],
          },
          {
            id: 'ai-coding.daily.context',
            title: 'Context: CLAUDE.md, skills, subagents and hooks',
            kind: 'build',
            hours: 5,
            detail:
              'Write the project instructions an agent needs (like this repository’s CLAUDE.md), turn a repeated procedure into a skill, try a subagent for a search, and a hook that runs the linter after each edit.',
            outcome:
              'An agent that follows your project’s rules without being told twice.',
            resources: [r('Claude Code docs', 'https://code.claude.com/docs')],
          },
          {
            id: 'ai-coding.daily.workflows',
            title: 'Agentic workflows: plan, parallel and headless',
            kind: 'build',
            hours: 5,
            detail:
              'Plan first and approve the plan, write the spec and the test before the code, run two agents in parallel in separate git worktrees, and run one headless in CI to fix lint or review a pull request.',
            outcome:
              'You run several agents at once on one feature and stay in control of each.',
            resources: [
              r(
                'Anthropic, Claude Code best practices for agentic coding',
                'https://www.anthropic.com/engineering/claude-code-best-practices',
              ),
              r(
                'Claude Code docs, Common workflows',
                'https://code.claude.com/docs/en/common-workflows',
              ),
            ],
          },
        ],
      },
      {
        id: 'api',
        title: 'Building on model APIs',
        goal: 'Call a model from your own code and control its shape, speed and cost.',
        level: 'working',
        checkpoint:
          'A small feature that calls the Claude API with structured output, its cost per use and its slowest answers measured.',
        steps: [
          {
            id: 'ai-coding.api.messages',
            title: 'Messages, streaming and models',
            kind: 'learn',
            hours: 5,
            detail:
              'Send a request with the TypeScript SDK, stream the answer, pick Haiku, Sonnet or Opus for the job, read the usage to know what a call cost.',
            outcome:
              'A small script that answers a question about one of your documents.',
            resources: [
              r(
                'Anthropic Academy, Building with the Claude API',
                'https://anthropic.skilljar.com/',
              ),
              r(
                'Anthropic courses on GitHub',
                'https://github.com/anthropics/courses',
              ),
            ],
          },
          {
            id: 'ai-coding.api.structured',
            title: 'Structured outputs and tool use',
            kind: 'build',
            hours: 6,
            detail:
              'Ask for JSON that follows a Zod schema (as svc-work does for the career feedback), then give the model a tool to call and handle the loop yourself.',
            outcome:
              'You can read every AI tool of Life Island and change one.',
            resources: [
              r(
                'Claude docs, Tool use',
                'https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview',
              ),
              r(
                'Exercise: read apps/svc-work/src/app/work/career-advisor.ts',
                null,
              ),
            ],
          },
          {
            id: 'ai-coding.api.cost',
            title: 'Tokens, latency and cost',
            kind: 'practice',
            hours: 4,
            detail:
              'Count tokens before you send, cache a long system prompt, compare effort levels, batch what can wait, and stream what a person watches. Read the cost per use that Settings → AI tools shows for each tool.',
            outcome:
              'You can halve the cost or the wait of a tool without losing quality.',
            resources: [
              r(
                'Claude docs, Prompt caching',
                'https://docs.claude.com/en/docs/build-with-claude/prompt-caching',
              ),
              r(
                'Claude docs, Batch processing',
                'https://docs.claude.com/en/docs/build-with-claude/batch-processing',
              ),
              r(
                'Claude docs, Token counting',
                'https://docs.claude.com/en/docs/build-with-claude/token-counting',
              ),
            ],
          },
        ],
      },
      {
        id: 'agents',
        title: 'Agents, tools, skills and MCP',
        goal: 'Know when an agent beats a fixed workflow, and give it tools it uses well.',
        level: 'professional',
        checkpoint:
          'An MCP server or skill of yours that a colleague uses without your help.',
        steps: [
          {
            id: 'ai-coding.agents.patterns',
            title: 'Workflows and agents',
            kind: 'learn',
            hours: 3,
            detail:
              'Prompt chaining, routing, parallel calls, orchestrator and workers, evaluator and optimizer: the simple patterns first, an agent only when they are not enough.',
            outcome: 'You can say which pattern a feature needs, and why.',
            resources: [
              r(
                'Anthropic, Building effective agents',
                'https://www.anthropic.com/engineering/building-effective-agents',
              ),
            ],
          },
          {
            id: 'ai-coding.agents.tools',
            title: 'Design tools an agent can use',
            kind: 'build',
            hours: 4,
            detail:
              'A tool is an interface for a model, not for a program: few tools that each do one job, clear names, errors the model can act on, results short enough to fit. Rewrite one tool and measure the difference.',
            outcome:
              'Tools that an agent picks correctly the first time, with fewer tokens.',
            resources: [
              r(
                'Anthropic, Writing effective tools for agents',
                'https://www.anthropic.com/engineering/writing-tools-for-agents',
              ),
            ],
          },
          {
            id: 'ai-coding.agents.mcp',
            title: 'Model Context Protocol',
            kind: 'build',
            hours: 8,
            detail:
              'What a server exposes (tools, resources, prompts), then write a small MCP server in TypeScript and connect it to Claude Code.',
            outcome: 'Your own MCP server, working in Claude Code.',
            resources: [
              r(
                'Anthropic Academy, Introduction to Model Context Protocol',
                'https://anthropic.skilljar.com/',
              ),
              r('modelcontextprotocol.io', 'https://modelcontextprotocol.io/'),
            ],
          },
          {
            id: 'ai-coding.agents.skills',
            title: 'Agent Skills',
            kind: 'build',
            hours: 4,
            detail:
              'A skill is a folder of instructions, scripts and references an agent loads only when the task needs it. Write one for a procedure your team repeats, and keep its description sharp enough that it triggers at the right time.',
            outcome:
              'A skill your team shares, that turns a ten-step procedure into one ask.',
            resources: [
              r(
                'Anthropic, Equipping agents for the real world with Agent Skills',
                'https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills',
              ),
              r(
                'Claude docs, Agent Skills',
                'https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview',
              ),
            ],
          },
          {
            id: 'ai-coding.agents.sdk',
            title: 'The Claude Agent SDK',
            kind: 'build',
            hours: 6,
            detail:
              'Build a small agent with the same loop as Claude Code: tools, permissions, subagents. Give it one job, for example tidying the notes of your study sessions.',
            outcome: 'An agent of your own that finishes a real task.',
            resources: [
              r(
                'Claude docs, Agent SDK',
                'https://docs.claude.com/en/docs/agent-sdk/overview',
              ),
            ],
          },
          {
            id: 'ai-coding.agents.computer-use',
            title: 'Browser and computer-use agents',
            kind: 'practice',
            hours: 4,
            detail:
              'Agents that click and type: a browser driven through Playwright MCP, then the computer-use tool. Where they beat an API, why they are slow and fragile, and how to keep them in a sandbox.',
            outcome:
              'You know when an agent should use a screen and when it needs an API.',
            resources: [
              r(
                'Claude docs, Computer use tool',
                'https://docs.claude.com/en/docs/agents-and-tools/tool-use/computer-use-tool',
              ),
              r(
                'Playwright MCP',
                'https://github.com/microsoft/playwright-mcp',
              ),
            ],
          },
        ],
      },
      {
        id: 'rag',
        title: 'Context from your data: retrieval and memory',
        goal: 'Give a model the right knowledge at the right time, and nothing more.',
        level: 'professional',
        checkpoint:
          'A question-answering tool over your own documents that cites its sources.',
        steps: [
          {
            id: 'ai-coding.rag.embeddings',
            title: 'Embeddings and vector search',
            kind: 'learn',
            hours: 4,
            detail:
              'What an embedding is, cosine similarity, chunking, and pgvector: the Postgres image Life Island runs already has it.',
            outcome:
              'You can find the three most similar documents to a question.',
            resources: [
              r('pgvector', 'https://github.com/pgvector/pgvector'),
              r(
                'DeepLearning.AI short courses (free)',
                'https://www.deeplearning.ai/short-courses/',
              ),
            ],
          },
          {
            id: 'ai-coding.rag.build',
            title: 'Retrieval-augmented generation',
            kind: 'build',
            hours: 8,
            detail:
              'Search first, then answer with the passages found and cite them. Measure whether the right passage was found before blaming the model.',
            outcome:
              'A question box over your own documents that cites its sources.',
            resources: [
              r(
                'Claude docs, Citations',
                'https://docs.claude.com/en/docs/build-with-claude/citations',
              ),
            ],
          },
          {
            id: 'ai-coding.rag.context',
            title: 'Context engineering and memory',
            kind: 'learn',
            hours: 3,
            detail:
              'The context window is a budget. Decide what goes in, what an agent fetches only when needed, what it writes down to remember between sessions, and what you compact away.',
            outcome:
              'An agent that stays sharp on a long task instead of drowning in its own history.',
            resources: [
              r(
                'Anthropic, Effective context engineering for AI agents',
                'https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents',
              ),
              r(
                'Claude docs, Memory tool',
                'https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool',
              ),
            ],
          },
        ],
      },
      {
        id: 'architecture',
        title: 'Agentic architectures',
        goal: 'Design systems of agents that are worth their cost and fail safely.',
        level: 'professional',
        checkpoint:
          'An architecture decision record for a real feature: the pattern chosen, its token budget, its failure modes and the fallback, reviewed by a peer.',
        steps: [
          {
            id: 'ai-coding.architecture.multi-agent',
            title: 'Orchestrators, subagents and multi-agent systems',
            kind: 'learn',
            hours: 4,
            detail:
              'An orchestrator that hands parallel work to subagents, each with its own clean context. Learn where it shines (broad research) and what it costs: several times the tokens of one agent.',
            outcome:
              'You can say when a second agent pays for itself, and when it only adds cost.',
            resources: [
              r(
                'Anthropic, How we built our multi-agent research system',
                'https://www.anthropic.com/engineering/multi-agent-research-system',
              ),
            ],
          },
          {
            id: 'ai-coding.architecture.long-running',
            title:
              'Long-running agents: state, retries and a human in the loop',
            kind: 'build',
            hours: 8,
            detail:
              'An agent that works for hours must survive a crash: save progress as it goes, make tools safe to repeat, retry with a limit, and stop for a person before anything it cannot undo.',
            outcome:
              'An agent job that resumes where it stopped and never acts twice.',
            resources: [
              r(
                'Anthropic, Effective harnesses for long-running agents',
                'https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents',
              ),
            ],
          },
          {
            id: 'ai-coding.architecture.design',
            title: 'Design review: workflow, agent or many agents',
            kind: 'practice',
            hours: 3,
            detail:
              'Take a feature you would build at work and write the decision: which pattern, which model where, the tokens per run and per month, what happens when the model is wrong, and the simpler option you rejected.',
            outcome:
              'A design you can defend in front of a senior architect and a finance lead.',
            resources: [
              r(
                'Exercise: write the decision record for one AI feature of Life Island',
                null,
              ),
            ],
          },
        ],
      },
      {
        id: 'product',
        title: 'AI features people trust',
        goal: 'Ship AI inside a web app: streaming, honest about mistakes, useful without it.',
        level: 'professional',
        checkpoint:
          'One AI feature in Life Island that streams, shows where its answer came from, lets you edit it, and still works with the tool off.',
        steps: [
          {
            id: 'ai-coding.product.streaming',
            title: 'Streaming into an Angular UI',
            kind: 'build',
            hours: 6,
            detail:
              'Stream the model through a Nest endpoint as server-sent events into signals: partial text and partial structured output, a stop button that really cancels, errors mid-stream.',
            outcome: 'An answer that starts appearing in under a second.',
            resources: [
              r(
                'Claude docs, Streaming messages',
                'https://docs.claude.com/en/docs/build-with-claude/streaming',
              ),
              r(
                'MDN, Server-sent events',
                'https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events',
              ),
            ],
          },
          {
            id: 'ai-coding.product.ux',
            title: 'Design for a model that can be wrong',
            kind: 'learn',
            hours: 3,
            detail:
              'Show sources, make every output editable, ask before acting, explain what data is sent, and keep a path that works without AI. The guidelines from teams that shipped AI to millions.',
            outcome: 'AI features users rely on because they can check them.',
            resources: [
              r(
                'Google PAIR, People + AI Guidebook',
                'https://pair.withgoogle.com/guidebook/',
              ),
              r(
                'Microsoft, Guidelines for Human-AI Interaction',
                'https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/',
              ),
            ],
          },
          {
            id: 'ai-coding.product.documents',
            title: 'Images, PDFs and citations',
            kind: 'practice',
            hours: 3,
            detail:
              'Send a payslip PDF or a photo, get structured data back, and cite the exact passage each value came from so the user can check it.',
            outcome: 'Document features with answers anyone can verify.',
            resources: [
              r(
                'Claude docs, PDF support',
                'https://docs.claude.com/en/docs/build-with-claude/pdf-support',
              ),
              r(
                'Claude docs, Citations',
                'https://docs.claude.com/en/docs/build-with-claude/citations',
              ),
            ],
          },
        ],
      },
      {
        id: 'scale',
        title: 'Cost, speed and compliance at scale',
        goal: 'Run AI features for many users at a cost and risk you can defend.',
        level: 'expert',
        checkpoint:
          'One AI feature’s cost per use cut by half with caching, batching or routing, measured, and a one-page data and AI Act note for it.',
        steps: [
          {
            id: 'ai-coding.scale.caching',
            title: 'Prompt caching and batches',
            kind: 'build',
            hours: 4,
            detail:
              'Put the stable part of the prompt first and cache it; send work that can wait as a batch at half the price. Measure the hit rate and the saving on a real feature.',
            outcome: 'The same feature at a fraction of the cost.',
            resources: [
              r(
                'Claude docs, Prompt caching',
                'https://docs.claude.com/en/docs/build-with-claude/prompt-caching',
              ),
              r(
                'Claude docs, Batch processing',
                'https://docs.claude.com/en/docs/build-with-claude/batch-processing',
              ),
            ],
          },
          {
            id: 'ai-coding.scale.routing',
            title: 'Routing, fallbacks and limits',
            kind: 'build',
            hours: 4,
            detail:
              'Send easy requests to a small model and hard ones to a large one, retry with backoff, fall back when a model is down, and cap spend per user and per day.',
            outcome: 'A feature that stays up and inside its budget.',
            resources: [
              r(
                'Claude docs, Rate limits',
                'https://docs.claude.com/en/api/rate-limits',
              ),
            ],
          },
          {
            id: 'ai-coding.scale.governance',
            title: 'Privacy, data and the EU AI Act',
            kind: 'learn',
            hours: 4,
            detail:
              'What data leaves your system and where it is kept, removing personal data before a prompt, retention and logs, and what the EU AI Act asks of a company that deploys AI by risk level.',
            outcome:
              'You can answer the legal and security questions about an AI feature before they are asked.',
            resources: [
              r(
                'EU Artificial Intelligence Act (explorer)',
                'https://artificialintelligenceact.eu/',
              ),
              r('Anthropic Trust Center', 'https://trust.anthropic.com/'),
            ],
          },
        ],
      },
      {
        id: 'production',
        title: 'Testing, security and operations',
        goal: 'Ship agentic features you can measure, trust and run.',
        level: 'expert',
        checkpoint:
          'An eval suite that catches a regression before it ships, and a talk to your team on how you built and secured it.',
        steps: [
          {
            id: 'ai-coding.production.evals',
            title: 'Evals',
            kind: 'build',
            hours: 6,
            detail:
              'Write the success criteria first, collect 20 real cases, score them by code where you can and with a model where you must. Run them each time the prompt changes (tools/evals in this repository).',
            outcome:
              'A number that tells you if a prompt change made things better.',
            resources: [
              r(
                'Claude docs, Define success and build evals',
                'https://docs.claude.com/en/docs/test-and-evaluate/define-success',
              ),
            ],
          },
          {
            id: 'ai-coding.production.testing-agents',
            title: 'Test agents, not only answers',
            kind: 'build',
            hours: 6,
            detail:
              'An agent can reach the right answer the wrong way. Check its path too: which tools it called, in what order, with what arguments. Record runs to replay them, grade with a model only once you checked the grader against your own judgement, and run the suite in CI.',
            outcome:
              'A regression suite for an agent that fails the build when it gets worse.',
            resources: [
              r(
                'Claude docs, Create strong empirical evaluations',
                'https://docs.claude.com/en/docs/test-and-evaluate/develop-tests',
              ),
            ],
          },
          {
            id: 'ai-coding.production.safety',
            title: 'Prompt injection and data security',
            kind: 'learn',
            hours: 4,
            detail:
              'Text inside a document or a tool result is never an instruction. Keep secrets and personal data out of prompts, give each agent the least access it needs, sandbox what it runs, and know the OWASP list of LLM risks.',
            outcome:
              'You can spot the injection or data leak in a feature before it ships.',
            resources: [
              r(
                'OWASP Top 10 for LLM applications',
                'https://owasp.org/www-project-top-10-for-large-language-model-applications/',
              ),
            ],
          },
          {
            id: 'ai-coding.production.observability',
            title: 'Observability: traces, tokens and latency',
            kind: 'build',
            hours: 4,
            detail:
              'Trace every model and tool call with its tokens, cost and time, so a slow or expensive run is a query away. Alert on cost per day and on the slowest answers, not only on errors.',
            outcome:
              'A dashboard that shows what each AI feature costs and where its time goes.',
            resources: [
              r(
                'OpenTelemetry semantic conventions for generative AI',
                'https://opentelemetry.io/docs/specs/semconv/gen-ai/',
              ),
              r(
                'Langfuse docs (tracing and evals)',
                'https://langfuse.com/docs',
              ),
            ],
          },
          {
            id: 'ai-coding.production.lead',
            title: 'Lead AI adoption on your team',
            kind: 'practice',
            hours: 4,
            detail:
              'Write the team’s rules for AI code (what an agent may do, what a person must review), share the skills and project instructions that work, and measure the effect honestly: lead time and defects, not lines written.',
            outcome:
              'Your team works faster with agents, and you can show it with numbers.',
            resources: [
              r(
                'DORA research on AI in software delivery',
                'https://dora.dev/research/ai/',
              ),
            ],
          },
        ],
      },
    ],
  },

  // -------------------------------------------------------- AI, theory
  {
    id: 'ai-theory',
    topic: 'ai-internals',
    emblem: '🧠',
    name: 'How AI works, inside out',
    summary:
      'The theory under the tools: neural networks, the transformer, how a base model becomes an assistant, and an agent harness you build yourself.',
    why: 'Most developers stop at the tools. Knowing what happens inside the model is what lets you predict where an agent will fail, debug it when it does, and build your own harness instead of only using one.',
    level: 'beginner',
    capstone:
      'Your own coding-agent harness in TypeScript over the raw model API (tools, context compaction, permissions), with a write-up that explains each part down to the transformer.',
    certifications: [
      'Hugging Face LLM Course (free certificate)',
      'DeepLearning.AI Deep Learning Specialization (Coursera, paid)',
    ],
    stages: [
      {
        id: 'ml',
        title: 'The machine learning underneath',
        goal: 'Know how a network learns, from a loss to a gradient.',
        level: 'foundations',
        checkpoint:
          'A tiny neural network you wrote yourself, trained, with every line of its backpropagation explained.',
        steps: [
          {
            id: 'ai-theory.ml.maths',
            title: 'The maths you actually need',
            kind: 'learn',
            hours: 6,
            detail:
              'Vectors and matrices, the dot product as similarity, derivatives and the chain rule, probability, softmax and log-likelihood. Just enough to read a model diagram and a paper without stopping at every line.',
            outcome: 'Equations in an AI paper read as ideas, not as a wall.',
            resources: [
              r(
                '3Blue1Brown, Essence of linear algebra',
                'https://www.3blue1brown.com/topics/linear-algebra',
              ),
              r(
                'Mathematics for Machine Learning (free book)',
                'https://mml-book.github.io/',
              ),
            ],
          },
          {
            id: 'ai-theory.ml.networks',
            title: 'Neural networks and gradient descent',
            kind: 'learn',
            hours: 5,
            detail:
              'A neuron, a layer, a loss that says how wrong the network is, and gradient descent that nudges every weight to be less wrong. Watch it visually before you read any maths.',
            outcome:
              'You can explain what training changes, and why it needs so much data.',
            resources: [
              r(
                '3Blue1Brown, Neural networks (visual series)',
                'https://www.3blue1brown.com/topics/neural-networks',
              ),
            ],
          },
          {
            id: 'ai-theory.ml.micrograd',
            title: 'Backpropagation from scratch',
            kind: 'build',
            hours: 6,
            detail:
              'Write a tiny automatic differentiation engine and train a small network with it, following along line by line. Rewrite it in TypeScript if that helps it stick.',
            outcome: 'Backpropagation is code you wrote, not a word you heard.',
            resources: [
              r(
                'Andrej Karpathy, Neural Networks: Zero to Hero',
                'https://karpathy.ai/zero-to-hero.html',
              ),
              r('micrograd', 'https://github.com/karpathy/micrograd'),
            ],
          },
        ],
      },
      {
        id: 'transformer',
        title: 'Inside a language model',
        goal: 'Follow a token from text to the next-word guess.',
        level: 'working',
        checkpoint:
          'A transformer block drawn on a whiteboard, with a token walked through it, to a colleague.',
        steps: [
          {
            id: 'ai-theory.transformer.tokens',
            title: 'Tokens and embeddings',
            kind: 'learn',
            hours: 4,
            detail:
              'How text becomes tokens (byte-pair encoding), how a token becomes a vector, and why tokens explain odd failures: spelling, counting letters, arithmetic, other languages costing more.',
            outcome:
              'You can predict which inputs a model will find hard, and why.',
            resources: [
              r(
                "Andrej Karpathy, Let's build the GPT tokenizer (video)",
                'https://www.youtube.com/watch?v=zduSFxRajkE',
              ),
            ],
          },
          {
            id: 'ai-theory.transformer.attention',
            title: 'Attention and the transformer',
            kind: 'learn',
            hours: 5,
            detail:
              'Attention lets each token look at the others and decide what matters. Then many heads, positions, the feed-forward layer and the residual stream that carries it all. Read the original paper last.',
            outcome:
              'You can explain why a model sees a whole context at once, and what that costs.',
            resources: [
              r(
                'Jay Alammar, The Illustrated Transformer',
                'https://jalammar.github.io/illustrated-transformer/',
              ),
              r(
                'Vaswani et al., Attention Is All You Need (paper)',
                'https://arxiv.org/abs/1706.03762',
              ),
            ],
          },
          {
            id: 'ai-theory.transformer.gpt',
            title: 'Build a small GPT',
            kind: 'build',
            hours: 10,
            detail:
              'Train a character-level GPT on a small text, from an empty file to generated sentences. Change the context length and the number of layers, and watch what each does.',
            outcome:
              'A language model you trained yourself, and no part of it is magic.',
            resources: [
              r(
                "Andrej Karpathy, Let's build GPT from scratch (video)",
                'https://www.youtube.com/watch?v=kCc8FmEb1nY',
              ),
              r('nanoGPT', 'https://github.com/karpathy/nanoGPT'),
            ],
          },
        ],
      },
      {
        id: 'assistant',
        title: 'From base model to assistant',
        goal: 'Know how training, sampling and reasoning shape what you get back.',
        level: 'working',
        checkpoint:
          'Explain, without notes, why the same prompt can answer differently, why a model invents an API, and what a context window really limits.',
        steps: [
          {
            id: 'ai-theory.assistant.training',
            title: 'Pretraining, fine-tuning and feedback',
            kind: 'learn',
            hours: 4,
            detail:
              'Pretraining on the internet makes a document completer. Fine-tuning on conversations and learning from feedback (people’s or a written constitution) make it an assistant. Know what each stage adds and what it cannot fix.',
            outcome:
              'You can say where a model’s knowledge, style and refusals come from.',
            resources: [
              r(
                'Andrej Karpathy, Deep dive into LLMs like ChatGPT (video)',
                'https://www.youtube.com/watch?v=7xTGNNLPyMI',
              ),
              r(
                'Anthropic, Constitutional AI',
                'https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback',
              ),
            ],
          },
          {
            id: 'ai-theory.assistant.sampling',
            title: 'Tokens, context window and sampling',
            kind: 'practice',
            hours: 4,
            detail:
              'Why the context window limits what the model knows, what temperature changes, why the same prompt can answer differently, and what a model cannot know (anything after its training). Try each one on the API.',
            outcome:
              'You can explain why a long chat gets worse and why a model invents an API.',
            resources: [
              r(
                'Andrej Karpathy, Intro to Large Language Models (1 h video)',
                'https://www.youtube.com/watch?v=zjkBMFhNj_g',
              ),
            ],
          },
          {
            id: 'ai-theory.assistant.reasoning',
            title: 'Reasoning and tool calls',
            kind: 'learn',
            hours: 3,
            detail:
              'Thinking before answering spends tokens to buy accuracy. A tool call is just text the model writes in a format the harness reads. Knowing both explains most of what an agent does.',
            outcome:
              'You can read an agent’s transcript and say why it did each step.',
            resources: [
              r(
                'Claude docs, Extended thinking',
                'https://docs.claude.com/en/docs/build-with-claude/extended-thinking',
              ),
            ],
          },
        ],
      },
      {
        id: 'training',
        title: 'Train and adapt a model',
        goal: 'Know what scale, data and fine-tuning really buy, by doing it.',
        level: 'professional',
        checkpoint:
          'A small open model fine-tuned with LoRA on a task of yours, beating its base model on an eval you wrote, with the numbers.',
        steps: [
          {
            id: 'ai-theory.training.scaling',
            title: 'Scaling laws and data',
            kind: 'learn',
            hours: 4,
            detail:
              'Why loss falls predictably with parameters, data and compute; why data quality and deduplication matter as much as size; where synthetic data helps and where it collapses.',
            outcome:
              'You can explain why models got better, and what will and will not keep improving.',
            resources: [
              r(
                'Kaplan et al., Scaling Laws for Neural Language Models (paper)',
                'https://arxiv.org/abs/2001.08361',
              ),
              r(
                'Hoffmann et al., Training Compute-Optimal LLMs (Chinchilla, paper)',
                'https://arxiv.org/abs/2203.15556',
              ),
            ],
          },
          {
            id: 'ai-theory.training.finetune',
            title: 'Fine-tune a small open model',
            kind: 'build',
            hours: 8,
            detail:
              'Prepare a small dataset, fine-tune an open model with LoRA on a free GPU notebook, and compare it with the base model and with a good prompt. Most of the time the prompt wins: find the case where it does not.',
            outcome:
              'You know when fine-tuning is worth it, from a model you trained.',
            resources: [
              r(
                'Hugging Face, LLM Course',
                'https://huggingface.co/learn/llm-course',
              ),
              r('Hu et al., LoRA (paper)', 'https://arxiv.org/abs/2106.09685'),
            ],
          },
          {
            id: 'ai-theory.training.benchmarks',
            title: 'Benchmarks and their limits',
            kind: 'practice',
            hours: 4,
            detail:
              'What a benchmark measures, contamination, why leaderboard gaps rarely show up in your task, and how to run a standard eval on a model yourself.',
            outcome: 'You read a model launch’s numbers with the right doubt.',
            resources: [
              r(
                'EleutherAI, LM Evaluation Harness',
                'https://github.com/EleutherAI/lm-evaluation-harness',
              ),
            ],
          },
        ],
      },
      {
        id: 'inference',
        title: 'Inference: from weights to tokens',
        goal: 'Know why output tokens cost what they cost, and run a model yourself.',
        level: 'professional',
        checkpoint:
          'A model running on your machine at two quantisations, with tokens per second, memory and quality measured and explained.',
        steps: [
          {
            id: 'ai-theory.inference.kv-cache',
            title: 'The KV cache and batching',
            kind: 'learn',
            hours: 4,
            detail:
              'Reading the prompt is parallel, writing the answer is one token at a time. The KV cache, prompt caching, batching and paged attention explain latency, price per token and why long contexts are expensive.',
            outcome:
              'You can predict the latency and cost of a request from its shape.',
            resources: [
              r(
                'Hugging Face, Transformers docs: caching',
                'https://huggingface.co/docs/transformers/en/kv_cache',
              ),
              r(
                'vLLM, PagedAttention',
                'https://blog.vllm.ai/2023/06/20/vllm.html',
              ),
            ],
          },
          {
            id: 'ai-theory.inference.local',
            title: 'Run a model on your machine',
            kind: 'build',
            hours: 5,
            detail:
              'Run an open model locally, then quantise it: 16, 8 and 4 bits. Measure tokens per second, memory and the drop in quality on a few prompts of yours.',
            outcome:
              'You know when a local model is enough and what it costs you.',
            resources: [
              r('llama.cpp', 'https://github.com/ggml-org/llama.cpp'),
              r('Ollama', 'https://ollama.com/'),
            ],
          },
          {
            id: 'ai-theory.inference.decoding',
            title: 'Decoding: sampling, structure and speed',
            kind: 'learn',
            hours: 3,
            detail:
              'Greedy, temperature and top-p; constrained decoding that guarantees JSON; speculative decoding that uses a small model to speed up a big one.',
            outcome:
              'You know how structured outputs are guaranteed and how serving gets faster.',
            resources: [
              r(
                'Leviathan et al., Fast Inference via Speculative Decoding (paper)',
                'https://arxiv.org/abs/2211.17192',
              ),
            ],
          },
        ],
      },
      {
        id: 'harness',
        title: 'Build your own agent harness',
        goal: 'Write the loop that turns a model into an agent, with no framework.',
        level: 'professional',
        checkpoint:
          'Your harness runs a multi-step coding task with tools, survives a full context window and asks before a risky command.',
        steps: [
          {
            id: 'ai-theory.harness.loop',
            title: 'The agent loop',
            kind: 'build',
            hours: 8,
            detail:
              'On the raw Messages API: send the conversation, read why the model stopped, run the tool it asked for, add the result, repeat. Give it three tools: read a file, write a file, run a command.',
            outcome:
              'A working coding agent in a few hundred lines that you fully understand.',
            resources: [
              r(
                'Claude docs, Tool use',
                'https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview',
              ),
              r(
                'Anthropic, Building effective agents',
                'https://www.anthropic.com/engineering/building-effective-agents',
              ),
            ],
          },
          {
            id: 'ai-theory.harness.context',
            title: 'Manage the context window',
            kind: 'build',
            hours: 6,
            detail:
              'Your loop will fill the window. Trim old tool results, summarise and compact the history, keep the stable part of the prompt first so it caches, and hand a search to a subagent so its noise stays out.',
            outcome:
              'A harness that keeps working on a long task at a cost you predicted.',
            resources: [
              r(
                'Claude docs, Context windows',
                'https://docs.claude.com/en/docs/build-with-claude/context-windows',
              ),
            ],
          },
          {
            id: 'ai-theory.harness.safety',
            title: 'Permissions and a sandbox',
            kind: 'build',
            hours: 5,
            detail:
              'Decide what the agent may do alone and what needs a yes. Run commands in a sandbox, keep secrets out of reach, and treat every tool result as data that may try to give orders.',
            outcome: 'A harness you would let run on your own machine.',
            resources: [
              r(
                'Claude Code docs, Security',
                'https://code.claude.com/docs/en/security',
              ),
            ],
          },
          {
            id: 'ai-theory.harness.mcp',
            title: 'Speak MCP',
            kind: 'build',
            hours: 5,
            detail:
              'Add a Model Context Protocol client to your harness: connect a server, list its tools, call them, show their results. Then write a tiny server and plug it in.',
            outcome:
              'Your harness uses any MCP server, and you know the protocol from both sides.',
            resources: [
              r(
                'Model Context Protocol, specification',
                'https://modelcontextprotocol.io/',
              ),
            ],
          },
          {
            id: 'ai-theory.harness.evals',
            title: 'Evaluate your harness',
            kind: 'practice',
            hours: 4,
            detail:
              'Ten real tasks with a check that passes or fails, run on every change to the harness: success rate, tokens and time. Learn how the public coding-agent benchmarks are built.',
            outcome: 'You change the harness with numbers, not impressions.',
            resources: [r('SWE-bench', 'https://www.swebench.com/')],
          },
          {
            id: 'ai-theory.harness.compare',
            title: 'Read a real harness',
            kind: 'practice',
            hours: 3,
            detail:
              'Read an open-source coding agent and the Agent SDK, and compare them with yours: how they plan, compact, ask for permission and recover from errors. Steal one idea.',
            outcome:
              'You know what a production harness does that yours does not, and why.',
            resources: [
              r(
                'Claude docs, Agent SDK',
                'https://docs.claude.com/en/docs/agent-sdk/overview',
              ),
              r(
                'Aider (open-source coding agent)',
                'https://github.com/Aider-AI/aider',
              ),
            ],
          },
        ],
      },
      {
        id: 'research',
        title: 'Interpretability and the frontier',
        goal: 'Keep up with the research, and explain it to others.',
        level: 'expert',
        checkpoint:
          'A talk or write-up that takes developers on your team from a token to an answer, and what we still do not understand.',
        steps: [
          {
            id: 'ai-theory.research.interpretability',
            title: 'Interpretability: what a model thinks',
            kind: 'learn',
            hours: 4,
            detail:
              'Features, superposition and circuits: how researchers find the concepts inside a model and trace how it plans an answer. It changes how you think about prompts.',
            outcome:
              'You can explain what is known about how a model reaches an answer, and what is not.',
            resources: [
              r(
                'Anthropic, Tracing the thoughts of a large language model',
                'https://www.anthropic.com/research/tracing-thoughts-language-model',
              ),
              r(
                'Transformer Circuits thread',
                'https://transformer-circuits.pub/',
              ),
            ],
          },
          {
            id: 'ai-theory.research.alignment',
            title: 'Alignment and safety',
            kind: 'learn',
            hours: 5,
            detail:
              'Reward hacking, sycophancy, deception in evaluations, model specifications and constitutions: why making a model behave is a research problem, and what it means for agents you deploy.',
            outcome:
              'You can explain why an agent might game its goal, and design against it.',
            resources: [
              r('Anthropic, Research', 'https://www.anthropic.com/research'),
              r('BlueDot Impact, AI safety courses', 'https://bluedot.org/'),
            ],
          },
          {
            id: 'ai-theory.research.papers',
            title: 'Read a paper a month',
            kind: 'practice',
            hours: 6,
            detail:
              'Abstract, figures, then the method; skip the proofs on a first read. Write five lines on each paper: the claim, the evidence, and what it changes for your work.',
            outcome:
              'A habit, and a notebook of papers you can actually discuss.',
            resources: [
              r('Hugging Face, Daily papers', 'https://huggingface.co/papers'),
            ],
          },
          {
            id: 'ai-theory.research.teach',
            title: 'Teach it',
            kind: 'build',
            hours: 4,
            detail:
              'Explaining is the test of understanding. Prepare a 30-minute session for your team on one part of this path, with a live demo of your GPT or your harness.',
            outcome:
              'Your team asks you when they need to understand AI, not only use it.',
            resources: [
              r(
                'Exercise: give the session and collect three questions you could not answer',
                null,
              ),
            ],
          },
        ],
      },
    ],
  },

  // --------------------------------------------------------------- angular
  {
    id: 'angular',
    topic: 'frameworks',
    emblem: '🅰️',
    name: 'Modern Angular, to expert',
    summary:
      'From signals and the new control flow to zoneless apps, architecture at scale and the tools that shape how a whole team writes Angular.',
    why: 'Angular is your daily tool. This path keeps you current as it changes fast (signals, zoneless, SSR) and takes you from using it well to being the person a team asks.',
    level: 'beginner',
    capstone:
      'A Life Island library of your own (a schematic, a lint rule or a shared component set) adopted by every area, with a short talk explaining it.',
    certifications: [],
    stages: [
      {
        id: 'modern',
        title: 'Modern Angular',
        goal: 'Write Angular the way the current docs do.',
        level: 'foundations',
        checkpoint:
          'A screen of yours rewritten with standalone components, signals and the new control flow, with no NgModule left.',
        steps: [
          {
            id: 'angular.modern.signals',
            title: 'Signals, computed and effects',
            kind: 'learn',
            hours: 4,
            detail:
              'What a signal is, how computed and effect track what they read, when an effect is the wrong tool, and input(), output() and model() as signals.',
            outcome:
              'You can replace a BehaviorSubject in a component with a signal and say what changed.',
            resources: [
              r('Angular docs, Signals', 'https://angular.dev/guide/signals'),
              r(
                'Angular docs, Learn Angular tutorial',
                'https://angular.dev/tutorials/learn-angular',
              ),
            ],
          },
          {
            id: 'angular.modern.templates',
            title: 'Standalone components and the new control flow',
            kind: 'learn',
            hours: 3,
            detail:
              'Standalone components and their imports, @if, @for with track, @switch, @let and @defer for lazy parts of a page.',
            outcome:
              'You can read and write any template in this repository without looking anything up.',
            resources: [
              r(
                'Angular docs, Components',
                'https://angular.dev/guide/components',
              ),
              r(
                'Angular docs, Templates',
                'https://angular.dev/guide/templates',
              ),
            ],
          },
          {
            id: 'angular.modern.migrate',
            title: 'Migrate a screen',
            kind: 'build',
            hours: 5,
            detail:
              'Take one older screen, run the official migrations (standalone, control flow, signal inputs), then finish by hand what they leave.',
            outcome:
              'A screen with no NgModule, no *ngIf and no @Input left, and its tests green.',
            resources: [
              r(
                'Angular docs, Migrations',
                'https://angular.dev/reference/migrations',
              ),
            ],
          },
        ],
      },
      {
        id: 'apps',
        title: 'Signal-first apps',
        goal: 'Build whole features on signals, from data to forms.',
        level: 'working',
        checkpoint:
          'A feature that loads, edits and saves data with signals end to end, running without zone.js.',
        steps: [
          {
            id: 'angular.apps.data',
            title: 'Loading data: resource, HttpClient and RxJS where it fits',
            kind: 'learn',
            hours: 4,
            detail:
              'resource() and httpResource() for data a signal depends on, HttpClient for commands, and the few places where RxJS still earns its keep (streams, debouncing, cancellation).',
            outcome:
              'You choose between a resource, a plain request and an observable for a given case, and can say why.',
            resources: [
              r('Angular docs, HTTP', 'https://angular.dev/guide/http'),
              r('RxJS, overview', 'https://rxjs.dev/guide/overview'),
            ],
          },
          {
            id: 'angular.apps.forms',
            title: 'Forms that scale',
            kind: 'learn',
            hours: 4,
            detail:
              'Typed reactive forms, validation and error messages, and what the newer signal-based forms change.',
            outcome:
              'You can build a long form with cross-field validation that a user never loses work in.',
            resources: [
              r('Angular docs, Forms', 'https://angular.dev/guide/forms'),
            ],
          },
          {
            id: 'angular.apps.zoneless',
            title: 'Zoneless change detection',
            kind: 'build',
            hours: 5,
            detail:
              'How change detection runs without zone.js, OnPush everywhere, and what breaks (setTimeout updates, third-party code) when you turn zone.js off.',
            outcome:
              'One app of yours running zoneless, with nothing stale on screen.',
            resources: [
              r('Angular docs, Zoneless', 'https://angular.dev/guide/zoneless'),
            ],
          },
        ],
      },
      {
        id: 'scale',
        title: 'Architecture at scale',
        goal: 'Keep a large Angular codebase fast and easy to change.',
        level: 'professional',
        checkpoint:
          'A measured improvement on a real app (bundle size, load time or build time) with the numbers before and after.',
        steps: [
          {
            id: 'angular.scale.libraries',
            title: 'Libraries, boundaries and Nx',
            kind: 'learn',
            hours: 5,
            detail:
              'Split an app into libraries with clear owners, enforce who may import what (Nx tags), and share code without a big shared folder.',
            outcome:
              "You can explain this repository's libs and tags and add a library the right way.",
            resources: [
              r(
                'Angular docs, Creating libraries',
                'https://angular.dev/tools/libraries/creating-libraries',
              ),
              r('Nx documentation', 'https://nx.dev'),
            ],
          },
          {
            id: 'angular.scale.performance',
            title: 'Runtime performance and SSR',
            kind: 'learn',
            hours: 5,
            detail:
              'Profile with the Angular DevTools, find needless change detection, lazy-load with @defer, and when server-side rendering and hydration pay off.',
            outcome: 'You can find and fix the slowest interaction of a page.',
            resources: [
              r(
                'Angular docs, Runtime performance',
                'https://angular.dev/best-practices/runtime-performance',
              ),
              r(
                'Angular docs, Server-side rendering',
                'https://angular.dev/guide/ssr',
              ),
              r('web.dev, Core Web Vitals', 'https://web.dev/articles/vitals'),
            ],
          },
          {
            id: 'angular.scale.testing',
            title: 'Testing that holds',
            kind: 'practice',
            hours: 6,
            detail:
              'Component tests that read like a user (harnesses, testing the DOM, not internals), and a few end-to-end tests where they matter.',
            outcome:
              'A feature of yours with tests that survived a refactor without being touched.',
            resources: [
              r('Angular docs, Testing', 'https://angular.dev/guide/testing'),
            ],
          },
        ],
      },
      {
        id: 'expert',
        title: 'Shaping how a team writes Angular',
        goal: 'Make the right way the easy way, for everyone.',
        level: 'expert',
        checkpoint:
          'A tool or guideline of yours that the team uses without you, and a talk or post that teaches it.',
        steps: [
          {
            id: 'angular.expert.schematics',
            title: 'Schematics and generators',
            kind: 'build',
            hours: 6,
            detail:
              'Write a generator that scaffolds a feature the way your team wants it, so no one copies an old folder again.',
            outcome: 'A generator your team runs instead of copying files.',
            resources: [
              r(
                'Angular docs, Authoring schematics',
                'https://angular.dev/tools/cli/schematics-authoring',
              ),
            ],
          },
          {
            id: 'angular.expert.design-system',
            title: 'A design system with accessibility built in',
            kind: 'build',
            hours: 8,
            detail:
              'Components with a small API, design tokens, keyboard and screen reader support by default, documented with examples.',
            outcome: 'A shared component others use without asking you how.',
            resources: [
              r(
                'Angular docs, Accessibility',
                'https://angular.dev/best-practices/a11y',
              ),
              r(
                'W3C, ARIA Authoring Practices Guide',
                'https://www.w3.org/WAI/ARIA/apg/',
              ),
            ],
          },
          {
            id: 'angular.expert.follow',
            title: 'Follow the framework as it moves',
            kind: 'practice',
            hours: 3,
            detail:
              'Read the release notes and RFCs of each major version, try what changed on a branch, and tell your team what to adopt and what to wait for.',
            outcome:
              'A short note to your team for each major version: what to adopt now, what later.',
            resources: [
              r('The Angular blog', 'https://blog.angular.dev'),
              r('Angular on GitHub', 'https://github.com/angular/angular'),
            ],
          },
        ],
      },
    ],
  },
  // ------------------------------------------------------------ frameworks
  {
    id: 'frameworks',
    topic: 'frameworks',
    emblem: '🧩',
    name: 'Beyond Angular',
    summary:
      'React and one more front-end framework, then the back end: Node, SQL, NestJS done properly, and Python for AI work.',
    why: 'You know Angular well: the fastest gains are React (most job posts ask for it), the back end you already touch in Life Island, and Python, the language of AI tooling.',
    level: 'beginner',
    capstone:
      'One Life Island screen rebuilt in React with Vite, served by a small FastAPI service that reads the same data through its own API.',
    certifications: [],
    stages: [
      {
        id: 'react',
        title: 'React for an Angular developer',
        goal: 'Map what you know (components, signals, DI) onto React.',
        level: 'working',
        checkpoint:
          'A small React app that does what one of your Angular screens does.',
        steps: [
          {
            id: 'frameworks.react.learn',
            title: 'Components, props, state and hooks',
            kind: 'learn',
            hours: 10,
            detail:
              'Do the official tutorial and "Thinking in React". Compare: signals and useState, computed and useMemo, effects and useEffect, services and context.',
            outcome: 'You can read any React codebase.',
            resources: [r('react.dev, Learn React', 'https://react.dev/learn')],
          },
          {
            id: 'frameworks.react.build',
            title: 'Build a small app with Vite',
            kind: 'build',
            hours: 8,
            detail:
              'A study timer with a list of sessions: routing, a form, fetching data, one test.',
            outcome: 'A React app of your own on GitHub.',
            resources: [r('Vite guide', 'https://vite.dev/guide/')],
          },
          {
            id: 'frameworks.react.next',
            title: 'Next.js and server rendering',
            kind: 'learn',
            hours: 8,
            detail:
              'Server components, routing by folders, data fetching on the server. Compare with Angular SSR.',
            outcome: 'You know when a full-stack framework is worth it.',
            resources: [r('Next.js Learn', 'https://nextjs.org/learn')],
          },
        ],
      },
      {
        id: 'other-front',
        title: 'A second view of the front end',
        goal: 'See a different take on reactivity.',
        level: 'working',
        checkpoint:
          'A short write-up comparing reactivity in Angular and one other framework.',
        steps: [
          {
            id: 'frameworks.other-front.vue-svelte',
            title: 'Vue or Svelte, one weekend',
            kind: 'learn',
            hours: 6,
            detail:
              'Pick one. Both have an interactive tutorial in the browser; Svelte compiles reactivity away, Vue is close to Angular templates.',
            outcome: 'An opinion of your own on frameworks, with reasons.',
            resources: [
              r('Vue tutorial', 'https://vuejs.org/tutorial/'),
              r('Svelte tutorial', 'https://svelte.dev/tutorial'),
            ],
          },
        ],
      },
      {
        id: 'backend',
        title: 'The back end',
        goal: 'Write and own a service, from the HTTP request to the table.',
        level: 'professional',
        checkpoint:
          'A service of yours in production, with its tests, its migrations and its logs.',
        steps: [
          {
            id: 'frameworks.backend.node',
            title: 'Node.js fundamentals',
            kind: 'learn',
            hours: 6,
            detail:
              'The event loop, modules, streams, environment variables, and how a process ends gracefully (as the parse worker does on SIGTERM).',
            outcome:
              'You understand what runs under every svc-* of Life Island.',
            resources: [r('Node.js Learn', 'https://nodejs.org/en/learn')],
          },
          {
            id: 'frameworks.backend.sql',
            title: 'SQL and PostgreSQL',
            kind: 'practice',
            hours: 8,
            detail:
              'Select, join, group by, indexes and transactions. Then open the Life Island database and answer three questions about your own data with SQL.',
            outcome: 'You write queries without an ORM.',
            resources: [
              r('SQLBolt (interactive)', 'https://sqlbolt.com/'),
              r(
                'PostgreSQL tutorial',
                'https://www.postgresql.org/docs/current/tutorial.html',
              ),
            ],
          },
          {
            id: 'frameworks.backend.nest',
            title: 'NestJS, properly',
            kind: 'build',
            hours: 8,
            detail:
              'Modules, providers, pipes, guards and testing. Add one endpoint to a Life Island service with its test.',
            outcome: 'A backend change of yours, merged.',
            resources: [r('NestJS docs', 'https://docs.nestjs.com/')],
          },
          {
            id: 'frameworks.backend.python',
            title: 'Python and FastAPI',
            kind: 'build',
            hours: 10,
            detail:
              'Python basics for a TypeScript developer, then a FastAPI service with typed models and automatic OpenAPI. Most AI libraries live here.',
            outcome: 'A small Python API you can call from Angular.',
            resources: [
              r('The Python tutorial', 'https://docs.python.org/3/tutorial/'),
              r('FastAPI tutorial', 'https://fastapi.tiangolo.com/tutorial/'),
            ],
          },
        ],
      },
    ],
  },

  // -------------------------------------------------------- infrastructure
  {
    id: 'infrastructure',
    topic: 'infrastructure',
    emblem: '🐳',
    name: 'Docker, Kubernetes and infrastructure',
    summary:
      'From the shell to containers, then Kubernetes, CI/CD and infrastructure as code: run and ship what you build.',
    why: 'Life Island already runs on Docker Compose. Understanding each line of infra/ is the first step; running it on Kubernetes is a real-world project for your CV.',
    level: 'beginner',
    capstone:
      'Life Island on a local Kubernetes cluster (kind): one service and its remote deployed with a Helm chart, built by a GitHub Actions workflow.',
    certifications: [
      'KCNA, Kubernetes and Cloud Native Associate (entry level)',
      'CKAD, Certified Kubernetes Application Developer (after the path)',
    ],
    stages: [
      {
        id: 'basics',
        title: 'Linux, the shell and networking',
        goal: 'Feel at home in a terminal on a server.',
        steps: [
          {
            id: 'infrastructure.basics.shell',
            title: 'The shell, processes and files',
            kind: 'learn',
            hours: 6,
            detail:
              'Navigation, pipes, permissions, environment variables, processes and signals, ssh. The Missing Semester covers what a computer science course forgets.',
            outcome:
              'You can find out why a process on a server is not running.',
            resources: [
              r('The Missing Semester (MIT)', 'https://missing.csail.mit.edu/'),
            ],
          },
          {
            id: 'infrastructure.basics.network',
            title: 'Networking for developers',
            kind: 'learn',
            hours: 4,
            detail:
              'DNS, ports, HTTP, TLS and reverse proxies: what Caddy does in front of Life Island.',
            outcome: 'You can trace a request from the browser to a container.',
            resources: [
              r(
                'MDN, Learn web development',
                'https://developer.mozilla.org/en-US/docs/Learn_web_development',
              ),
              r('Exercise: read infra/caddy/Caddyfile line by line', null),
            ],
          },
        ],
      },
      {
        id: 'docker',
        title: 'Containers with Docker',
        goal: 'Package any app into an image and run a stack of them.',
        steps: [
          {
            id: 'infrastructure.docker.basics',
            title: 'Images, containers, volumes',
            kind: 'learn',
            hours: 6,
            detail:
              'Run, build, layers and cache, volumes and networks. Why a container is not a virtual machine.',
            outcome: 'You can containerise a small app.',
            resources: [
              r('Docker, Get started', 'https://docs.docker.com/get-started/'),
            ],
          },
          {
            id: 'infrastructure.docker.dockerfile',
            title: 'Good Dockerfiles',
            kind: 'build',
            hours: 5,
            detail:
              'Multi-stage builds, small base images, a non-root user, .dockerignore, health checks. Read infra/docker/ in this repository and improve one thing.',
            outcome: 'An image half the size of your first one.',
            resources: [
              r(
                'Docker build best practices',
                'https://docs.docker.com/build/building/best-practices/',
              ),
            ],
          },
          {
            id: 'infrastructure.docker.compose',
            title: 'Docker Compose',
            kind: 'practice',
            hours: 4,
            detail:
              'Services, depends_on with health checks, profiles, env files: the whole of infra/docker-compose.yml explained to yourself.',
            outcome: 'You can add a service to the Life Island stack.',
            resources: [
              r('Docker Compose', 'https://docs.docker.com/compose/'),
            ],
          },
        ],
      },
      {
        id: 'kubernetes',
        title: 'Kubernetes',
        goal: 'Deploy, expose and update an app on a cluster.',
        steps: [
          {
            id: 'infrastructure.kubernetes.basics',
            title: 'Pods, deployments and services',
            kind: 'learn',
            hours: 8,
            detail:
              'The official interactive basics: create a deployment, expose it, scale it, roll out an update.',
            outcome: 'You can read a Kubernetes manifest.',
            resources: [
              r(
                'Kubernetes Basics (official tutorial)',
                'https://kubernetes.io/docs/tutorials/kubernetes-basics/',
              ),
            ],
          },
          {
            id: 'infrastructure.kubernetes.local',
            title: 'A cluster on your PC',
            kind: 'build',
            hours: 6,
            detail:
              'kind runs Kubernetes in Docker. Deploy one Life Island service with a ConfigMap, a Secret and an Ingress.',
            outcome: 'A service of yours running on Kubernetes.',
            resources: [
              r('kind', 'https://kind.sigs.k8s.io/'),
              r(
                'kubectl cheat sheet',
                'https://kubernetes.io/docs/reference/kubectl/quick-reference/',
              ),
            ],
          },
          {
            id: 'infrastructure.kubernetes.helm',
            title: 'Helm charts',
            kind: 'build',
            hours: 5,
            detail:
              'Template your manifests once, install them per environment.',
            outcome: 'One command deploys your service.',
            resources: [
              r('Helm quickstart', 'https://helm.sh/docs/intro/quickstart/'),
            ],
          },
          {
            id: 'infrastructure.kubernetes.labs',
            title: 'Hands-on labs',
            kind: 'practice',
            hours: 10,
            detail:
              'Exam-style exercises in a browser cluster: the fastest way to make kubectl muscle memory.',
            outcome: 'Ready for the KCNA, on the way to the CKAD.',
            resources: [r('KodeKloud', 'https://kodekloud.com/', false)],
          },
        ],
      },
      {
        id: 'delivery',
        title: 'Delivery and infrastructure as code',
        goal: 'Ship with a pipeline and describe servers in code.',
        steps: [
          {
            id: 'infrastructure.delivery.ci',
            title: 'CI/CD with GitHub Actions',
            kind: 'build',
            hours: 5,
            detail:
              'Read .github/workflows/ci.yml, then add a job that builds and pushes one image.',
            outcome: 'A pipeline you wrote yourself.',
            resources: [
              r('GitHub Actions docs', 'https://docs.github.com/en/actions'),
            ],
          },
          {
            id: 'infrastructure.delivery.iac',
            title: 'Terraform or OpenTofu',
            kind: 'learn',
            hours: 6,
            detail:
              'Providers, resources, state, plan and apply. Describe a small server (e.g. a Hetzner VPS) instead of clicking it.',
            outcome: 'You can recreate your infrastructure from a repository.',
            resources: [
              r(
                'Terraform tutorials',
                'https://developer.hashicorp.com/terraform/tutorials',
              ),
              r('OpenTofu docs', 'https://opentofu.org/docs/'),
            ],
          },
          {
            id: 'infrastructure.delivery.observability',
            title: 'Logs, metrics and traces',
            kind: 'learn',
            hours: 4,
            detail:
              'What OpenTelemetry collects and how a trace follows an upload through Life Island.',
            outcome: 'You can find the slow step of a request.',
            resources: [
              r('OpenTelemetry docs', 'https://opentelemetry.io/docs/'),
            ],
          },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ leadership
  {
    id: 'leadership',
    topic: 'leadership',
    emblem: '🧭',
    name: 'Becoming a team leader',
    summary:
      'The craft of leading developers: one-to-ones, feedback, delegation, planning, decisions and the team’s health, with practice on your current team.',
    why: 'You want to lead a team. Leading is learned by doing small parts of it now, with your manager’s support, and by reading what experienced leads wrote down.',
    level: 'beginner',
    capstone:
      'Lead one small initiative at work from start to finish: the plan, the people, the weekly updates and a retrospective, then ask for feedback on how you led it.',
    certifications: [],
    stages: [
      {
        id: 'role',
        title: 'What a tech lead does',
        goal: 'Know the job before you ask for it.',
        level: 'foundations',
        checkpoint:
          'Your own one-page description of the tech lead job, agreed with your manager.',
        steps: [
          {
            id: 'leadership.role.read',
            title: 'The Manager’s Path, first half',
            kind: 'learn',
            hours: 6,
            detail:
              'Camille Fournier’s book walks from being managed, to mentoring, to tech lead, to managing people. Read up to the tech lead chapter.',
            outcome:
              'You can describe the difference between a tech lead and a manager.',
            resources: [
              r('Book: The Manager’s Path, Camille Fournier', null, false),
            ],
          },
          {
            id: 'leadership.role.talk',
            title: 'Tell your manager',
            kind: 'practice',
            hours: 1,
            detail:
              'Say you want to grow towards leading a team and ask what they would need to see. Write the answer down in the step notes, and add it as a goal in Work.',
            outcome: 'A shared, written goal with your manager.',
            resources: [],
          },
        ],
      },
      {
        id: 'people',
        title: 'People',
        goal: 'Help each person do their best work.',
        level: 'working',
        checkpoint:
          'A month of regular one-on-ones, each ending with an agreed next step.',
        steps: [
          {
            id: 'leadership.people.mentoring',
            title: 'Mentor one person',
            kind: 'practice',
            hours: 6,
            detail:
              'Pair with a junior on a real task for a few weeks: ask questions before giving answers, let them drive.',
            outcome: 'Someone who got better because of you.',
            resources: [],
          },
          {
            id: 'leadership.people.feedback',
            title: 'Giving and asking for feedback',
            kind: 'learn',
            hours: 5,
            detail:
              'Care personally, challenge directly. Describe the situation, the behaviour and its impact; praise in public, criticise in private; ask for feedback on yourself first.',
            outcome: 'You can give a hard feedback without damaging trust.',
            resources: [r('Book: Radical Candor, Kim Scott', null, false)],
          },
          {
            id: 'leadership.people.one-to-ones',
            title: 'One-to-ones',
            kind: 'learn',
            hours: 2,
            detail:
              'Their meeting, not yours: their agenda, career, blockers. Regular, rarely cancelled, with notes.',
            outcome: 'A one-to-one template you would use.',
            resources: [
              r(
                'Lara Hogan, questions for one-to-ones',
                'https://larahogan.me/blog/first-one-on-one-questions/',
              ),
            ],
          },
          {
            id: 'leadership.people.conversations',
            title: 'Difficult conversations',
            kind: 'learn',
            hours: 5,
            detail:
              'Stay in dialogue when stakes are high, opinions differ and emotions run strong: conflicts, missed deadlines, saying no.',
            outcome:
              'A plan for the next tense conversation you know is coming.',
            resources: [r('Book: Crucial Conversations', null, false)],
          },
        ],
      },
      {
        id: 'delivery',
        title: 'Delivery',
        goal: 'Get a team to ship, predictably.',
        level: 'professional',
        checkpoint:
          'A quarter where the team shipped what it planned, and you can say why.',
        steps: [
          {
            id: 'leadership.delivery.delegation',
            title: 'Delegation',
            kind: 'practice',
            hours: 3,
            detail:
              'Give away the work you would enjoy most; agree on what done means and when you will check in, not how to do it.',
            outcome: 'Your first delegated task, finished without you.',
            resources: [
              r('Book: Turn the Ship Around!, L. David Marquet', null, false),
            ],
          },
          {
            id: 'leadership.delivery.rituals',
            title: 'Planning, stand-ups and retrospectives',
            kind: 'practice',
            hours: 4,
            detail:
              'Run one retrospective for your team: what went well, what did not, one action with an owner. Then plan a small piece of work with estimates and risks.',
            outcome: 'A retrospective that produced a change.',
            resources: [
              r(
                'Atlassian Team Playbook',
                'https://www.atlassian.com/team-playbook',
              ),
            ],
          },
          {
            id: 'leadership.delivery.decisions',
            title: 'Technical decisions in writing',
            kind: 'build',
            hours: 3,
            detail:
              'Write an RFC or an architecture decision record: the problem, options, the choice and its cost. docs/architecture.md is one.',
            outcome: 'A decision your team agreed on in writing.',
            resources: [r('ADR examples', 'https://adr.github.io/')],
          },
        ],
      },
      {
        id: 'team',
        title: 'The team as a system',
        goal: 'Shape how the team works, not only what it does.',
        level: 'expert',
        checkpoint:
          'A change to how the team works (a ritual, a process, a hire) that still holds months later.',
        steps: [
          {
            id: 'leadership.team.safety',
            title: 'Psychological safety',
            kind: 'learn',
            hours: 2,
            detail:
              'Google’s research on what makes teams effective: people can take risks without feeling insecure or embarrassed.',
            outcome: 'You know what to protect first in a team.',
            resources: [
              r(
                'Google’s Project Aristotle on team effectiveness (search "re:Work team effectiveness")',
                null,
              ),
            ],
          },
          {
            id: 'leadership.team.topologies',
            title: 'Team Topologies and An Elegant Puzzle',
            kind: 'learn',
            hours: 8,
            detail:
              'How team shape follows architecture, and the systems a lead uses to size teams, plan and handle growth.',
            outcome:
              'You can argue for a team change with a model, not a feeling.',
            resources: [
              r('Book: Team Topologies, Skelton and Pais', null, false),
              r('Book: An Elegant Puzzle, Will Larson', null, false),
            ],
          },
          {
            id: 'leadership.team.hiring',
            title: 'Interviewing',
            kind: 'practice',
            hours: 3,
            detail:
              'Join an interview panel: a structured interview, the same questions for each candidate, notes written before the debrief.',
            outcome: 'Your first hiring decision, made fairly.',
            resources: [],
          },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------- 3D
  {
    id: '3d',
    topic: '3d',
    emblem: '🧊',
    name: '3D for the web and Blender',
    summary:
      'Just enough maths, then three.js, Babylon.js and Blender: model something, bring it to the browser, make it move.',
    why: 'The island hub is three.js. You will understand its code, model your own characters in Blender and put them on the island.',
    level: 'beginner',
    capstone:
      'Model one Life Island character in Blender, export it as glTF, and load it on the island hub with an idle animation.',
    certifications: [],
    stages: [
      {
        id: 'maths',
        title: 'The maths behind 3D',
        goal: 'Vectors and matrices without fear.',
        steps: [
          {
            id: '3d.maths.linear',
            title: 'Vectors, matrices and transforms',
            kind: 'learn',
            hours: 4,
            detail:
              'Position, rotation and scale are matrices; a camera is one more. The visual series makes it intuitive.',
            outcome: 'You know why the order of transforms matters.',
            resources: [
              r(
                '3Blue1Brown, Essence of linear algebra',
                'https://www.3blue1brown.com/topics/linear-algebra',
              ),
            ],
          },
        ],
      },
      {
        id: 'threejs',
        title: 'three.js',
        goal: 'Build a 3D scene in the browser.',
        steps: [
          {
            id: '3d.threejs.fundamentals',
            title: 'Scene, camera, renderer, light',
            kind: 'learn',
            hours: 6,
            detail:
              'The official manual: primitives, materials, lights, the render loop, responsive canvas.',
            outcome: 'A spinning, lit object of your own.',
            resources: [r('three.js manual', 'https://threejs.org/manual/')],
          },
          {
            id: '3d.threejs.journey',
            title: 'Three.js Journey',
            kind: 'learn',
            hours: 20,
            detail:
              'The best-known course on three.js, from basics to shaders and React Three Fiber. Paid, but goes step by step.',
            outcome: 'You can build a portfolio scene.',
            resources: [
              r(
                'Three.js Journey, Bruno Simon',
                'https://threejs-journey.com/',
                false,
              ),
            ],
          },
          {
            id: '3d.threejs.island',
            title: 'Read the island hub',
            kind: 'practice',
            hours: 4,
            detail:
              'Open apps/shell and follow how the island, its landmarks and the camera are built. Change one landmark.',
            outcome: 'A change of yours on the island.',
            resources: [r('Exercise: apps/shell/src/app/hub', null)],
          },
        ],
      },
      {
        id: 'blender',
        title: 'Blender',
        goal: 'Model, texture and export a simple asset.',
        steps: [
          {
            id: '3d.blender.basics',
            title: 'Blender basics',
            kind: 'learn',
            hours: 10,
            detail:
              'The interface, navigation, modelling with modifiers, materials and lighting. The famous beginner donut series is the classic start.',
            outcome: 'Your first finished render.',
            resources: [
              r(
                'Blender tutorials (official)',
                'https://www.blender.org/support/tutorials/',
              ),
              r('Blender Studio', 'https://studio.blender.org/', false),
            ],
          },
          {
            id: '3d.blender.low-poly',
            title: 'A low-poly character',
            kind: 'build',
            hours: 10,
            detail:
              'Low-poly suits the island: block out a small dinosaur, a simple rig and an idle animation.',
            outcome: 'A character ready to export.',
            resources: [],
          },
          {
            id: '3d.blender.gltf',
            title: 'glTF: from Blender to the browser',
            kind: 'build',
            hours: 4,
            detail:
              'Export as .glb, keep it small (Draco, texture sizes), load it with GLTFLoader and play its animation.',
            outcome: 'Your model moving in the browser.',
            resources: [
              r('glTF overview (Khronos)', 'https://www.khronos.org/gltf/'),
              r(
                'three.js manual, Loading a .GLTF file',
                'https://threejs.org/manual/#en/load-gltf',
              ),
            ],
          },
        ],
      },
      {
        id: 'babylon',
        title: 'Babylon.js and shaders',
        goal: 'See a full engine, and what a shader is.',
        steps: [
          {
            id: '3d.babylon.basics',
            title: 'Babylon.js in the playground',
            kind: 'learn',
            hours: 6,
            detail:
              'An engine with physics, GUI and an inspector built in. Rebuild your three.js scene in the playground and compare.',
            outcome: 'You know when to pick Babylon over three.js.',
            resources: [
              r('Babylon.js docs', 'https://doc.babylonjs.com/'),
              r('Babylon.js playground', 'https://playground.babylonjs.com/'),
            ],
          },
          {
            id: '3d.babylon.shaders',
            title: 'A first shader',
            kind: 'learn',
            hours: 6,
            detail: 'Fragment shaders from zero: colours, shapes, noise.',
            outcome: 'A water shader for the island’s sea.',
            resources: [
              r('The Book of Shaders', 'https://thebookofshaders.com/'),
            ],
          },
        ],
      },
    ],
  },
  // --------------------------------------------------------------- finance
  {
    id: 'finance',
    topic: 'finance',
    emblem: '💶',
    name: 'Financial education',
    summary:
      'Money from zero, for an employee in Italy: budget and emergency fund, your payslip, IRPEF, the 730 and the F24, your pension, saving and investing, a mortgage and the home bonuses.',
    why: 'Life Island already reads your payslips, your CU, your 730, your bank movements and your pension fund. This path explains what those numbers mean, one plain idea at a time, so you can check them yourself and decide with confidence instead of trusting whoever explains it fastest.',
    level: 'beginner',
    capstone:
      'Your yearly money review, built from your own Life Island data: a one-page note with your monthly budget, your emergency fund, one payslip explained line by line, last year’s 730 checked against your CU, your TFR and pension fund choice, and a written investing plan.',
    certifications: [],
    stages: [
      {
        id: 'basics',
        title: 'Money basics',
        goal: 'Know where your money comes from, where it goes, and keep a cushion.',
        steps: [
          {
            id: 'finance.basics.words',
            title: 'The ten words that matter',
            kind: 'learn',
            hours: 3,
            detail:
              'Gross and net, RAL (your yearly gross salary), income and expenses, assets and debts, interest, inflation (why €100 buys less every year) and compound interest (interest that earns interest: small amounts over many years grow a lot). Read slowly, with a notebook.',
            outcome:
              'You can explain inflation and compound interest to a friend with an example.',
            resources: [
              r(
                'Banca d’Italia, L’economia per tutti',
                'https://economiapertutti.bancaditalia.it/',
              ),
              r(
                'Quello che conta, the national financial education portal',
                'https://www.quellocheconta.gov.it/',
              ),
              r(
                'Khan Academy, Personal finance',
                'https://www.khanacademy.org/college-careers-more/personal-finance',
              ),
            ],
          },
          {
            id: 'finance.basics.budget',
            title: 'A monthly budget',
            kind: 'build',
            hours: 4,
            detail:
              'Import one or two months of bank movements in Money and look at where the money went. Then set a budget per category; a simple start is 50/30/20: about half for needs (rent, bills, food), a third for wants, a fifth for saving. Your savings rate is the one number to watch.',
            outcome:
              'A budget in Money and your savings rate, which you check once a month.',
            resources: [
              r(
                'Quello che conta, planning your budget',
                'https://www.quellocheconta.gov.it/',
              ),
            ],
          },
          {
            id: 'finance.basics.emergency',
            title: 'An emergency fund',
            kind: 'practice',
            hours: 2,
            detail:
              'Before investing anything, keep three to six months of expenses in a separate account you can reach in a day: a broken car or a lost job then stays a problem and not a crisis. Pay off expensive debt (credit cards, consumer loans) first.',
            outcome:
              'A separate account with a target amount, and a monthly transfer that fills it.',
            resources: [
              r('Book: The Psychology of Money, Morgan Housel', null, false),
            ],
          },
        ],
      },
      {
        id: 'payslip',
        title: 'Your payslip and your pay',
        goal: 'Read every line of your busta paga and know where the gross goes.',
        steps: [
          {
            id: 'finance.payslip.read',
            title: 'From gross to net',
            kind: 'learn',
            hours: 3,
            detail:
              'Take one payslip from Work and follow the gross down: INPS contributions (about 9–10% of gross, they build your public pension), then IRPEF on what is left (the imponibile), minus the detrazioni for employees, then the regional and municipal add-ons (addizionali, withheld in instalments the year after). What remains is the net.',
            outcome:
              'You can point at each line of your payslip and say what it is for.',
            resources: [
              r(
                'Agenzia delle Entrate, guides for citizens',
                'https://www.agenziaentrate.gov.it/',
              ),
            ],
          },
          {
            id: 'finance.payslip.tfr',
            title: 'TFR, your severance pay',
            kind: 'learn',
            hours: 2,
            detail:
              'Every year about 7% of your pay (your yearly pay divided by 13.5) is set aside as TFR. It stays with the company (or the INPS treasury fund), revalued at 1.5% plus three quarters of inflation, or it goes to a pension fund. The choice to move it to a fund cannot be undone, so read the Work page that compares both before you decide.',
            outcome:
              'You know where your TFR is today and what each choice would give you.',
            resources: [r('INPS', 'https://www.inps.it/')],
          },
          {
            id: 'finance.payslip.cu',
            title: 'The CU, your year in one page',
            kind: 'practice',
            hours: 1,
            detail:
              'By 16 March your employer gives you the Certificazione Unica: what you earned last year, the taxes and contributions already withheld, your TFR. It is the starting point of the 730. Load it in Documents and compare its totals with the sum of your twelve payslips.',
            outcome: 'Your CU in Life Island, and its totals checked.',
            resources: [],
          },
        ],
      },
      {
        id: 'taxes',
        title: 'Italian taxes without fear',
        goal: 'Understand IRPEF, deductions and the 730 well enough to check your own return.',
        steps: [
          {
            id: 'finance.taxes.irpef',
            title: 'How IRPEF works: brackets',
            kind: 'learn',
            hours: 2,
            detail:
              'IRPEF is progressive: each rate applies only to the slice of income inside its bracket (scaglione). With the 2025 brackets (23% up to €28,000, 35% up to €50,000, 43% above), €30,000 of taxable income pays 23% on €28,000 and 35% on the last €2,000, not 35% on everything. So a rise never lowers your net. The rate of your last euro is your marginal rate; check the brackets of the current year, the budget law can change them.',
            outcome:
              'You can work out your marginal rate and why it matters for deductions.',
            resources: [
              r(
                'Agenzia delle Entrate, IRPEF',
                'https://www.agenziaentrate.gov.it/',
              ),
            ],
          },
          {
            id: 'finance.taxes.deductions',
            title: 'Deduzioni and detrazioni',
            kind: 'learn',
            hours: 3,
            detail:
              'A deduzione lowers your taxable income, so it is worth your marginal rate (your pension fund contributions). A detrazione lowers the tax itself by a fixed share: 19% of medical expenses above €129.11, of mortgage interest on your main home (up to €4,000 of interest), of school and sport costs. Most 19% detrazioni need a traceable payment (card or transfer), not cash; medicines and devices are the main exception. Keep the receipts: the 730 tax return area lists them per year.',
            outcome:
              'You know which of your expenses lower your taxes, and how to pay them so they count.',
            resources: [
              r(
                'Agenzia delle Entrate, the precompilata',
                'https://infoprecompilata.agenziaentrate.gov.it/',
              ),
            ],
          },
          {
            id: 'finance.taxes.730',
            title: '730 or Redditi PF',
            kind: 'learn',
            hours: 2,
            detail:
              'The 730 is the simple return for employees and pensioners: from the end of April the Agenzia prepares it (precompilata) from your CU and the expenses it knows; you check it, add what is missing and send it by 30 September, yourself with SPID or CIE, or through a CAF. A refund arrives in your payslip, usually from July. Redditi PF is the full return, for income the 730 cannot hold or when nobody can pay you the refund; it goes online by 31 October and taxes due are paid with the F24.',
            outcome:
              'You know which return you file and its deadline, and you can open your precompilata.',
            resources: [
              r(
                'Agenzia delle Entrate, the precompilata',
                'https://infoprecompilata.agenziaentrate.gov.it/',
              ),
            ],
          },
          {
            id: 'finance.taxes.check',
            title: 'Check your own 730',
            kind: 'practice',
            hours: 3,
            detail:
              'Open last year’s return in the 730 tax return area next to the forecast from your CU, payslips and expenses. Find where the two differ and why: a missing receipt, a deduction you did not know, an addizionale. Write down what to collect better this year.',
            outcome:
              'A short list of what to keep and pay traceably for next year’s return.',
            resources: [],
          },
          {
            id: 'finance.taxes.f24',
            title: 'The F24',
            kind: 'learn',
            hours: 1,
            detail:
              'The F24 is the form that pays almost every tax: IMU on homes that are not your main home (June and December), the balance and advances of Redditi PF (30 June and 30 November). Each line has a codice tributo saying what you are paying. You pay it from your home banking; a late payment can be fixed with a small penalty (ravvedimento operoso) if you act soon.',
            outcome:
              'You can read an F24 and know which dates go in your Agenda.',
            resources: [
              r(
                'Agenzia delle Entrate, F24',
                'https://www.agenziaentrate.gov.it/',
              ),
            ],
          },
        ],
      },
      {
        id: 'pension',
        title: 'Pension and the long term',
        goal: 'Know what pension to expect and whether a pension fund helps you.',
        steps: [
          {
            id: 'finance.pension.public',
            title: 'Your public pension',
            kind: 'practice',
            hours: 2,
            detail:
              'Your INPS pension is computed mostly from the contributions you paid (the contributivo system), so a gap in your career is a gap in your pension. Log in to INPS with SPID, download your estratto conto contributivo and check that every job is there; then try the "La mia pensione futura" simulator.',
            outcome:
              'Your contribution record checked, and an estimate of your pension and its date.',
            resources: [r('INPS', 'https://www.inps.it/')],
          },
          {
            id: 'finance.pension.fund',
            title: 'Pension funds (previdenza complementare)',
            kind: 'learn',
            hours: 3,
            detail:
              'A pension fund adds to the public pension. Three reasons it can pay off for an employee: your contributions are deducted from taxable income (up to €5,300 a year from 2026, €5,164.57 before), your employer often adds its own contribution only if you join, and at exit the tax is 15% falling to 9%, lower than IRPEF. The money is tied up until retirement, with some exceptions (first home, health). Compare costs with the ISC indicator.',
            outcome:
              'You know whether you are in a fund, what your employer adds, and how much room is left under the yearly limit (Work shows it).',
            resources: [
              r(
                'COVIP, the pension fund supervisor (guides and fund costs)',
                'https://www.covip.it/',
              ),
            ],
          },
        ],
      },
      {
        id: 'investing',
        title: 'Saving and investing basics',
        goal: 'Make your savings beat inflation without taking risks you do not understand.',
        steps: [
          {
            id: 'finance.investing.risk',
            title: 'Risk, return and time',
            kind: 'learn',
            hours: 3,
            detail:
              'More expected return always means more risk: there is no high, guaranteed return. Diversify (many companies and countries, not one), match the investment to when you will need the money (cash for under two years, bonds for a few, shares only for ten or more), and know that costs and selling in a panic hurt more than a bad year.',
            outcome:
              'You can say how much of your savings could fall 30% in a year without changing your life.',
            resources: [
              r(
                'Consob, investor education',
                'https://www.consob.it/web/investor-education',
              ),
              r(
                'Book: The Little Book of Common Sense Investing, John C. Bogle',
                null,
                false,
              ),
            ],
          },
          {
            id: 'finance.investing.tools',
            title: 'What you can buy, and its tax',
            kind: 'learn',
            hours: 4,
            detail:
              'Conto deposito (a savings account with a fixed rate), Italian and EU government bonds such as BTP (gains taxed at 12.5%), funds and ETFs (a basket of many shares or bonds; compare the yearly cost, the TER), single shares. Other gains are taxed at 26%. A securities account pays a 0.2% stamp duty a year, a current account €34.20 when the average balance is over €5,000.',
            outcome:
              'You can compare two products by risk, yearly cost and tax.',
            resources: [
              r(
                'Banca d’Italia, L’economia per tutti',
                'https://economiapertutti.bancaditalia.it/',
              ),
            ],
          },
          {
            id: 'finance.investing.plan',
            title: 'Write your investing plan',
            kind: 'practice',
            hours: 2,
            detail:
              'One page: the goal and its date (add it in Goals or Dreams), how much you put in each month (a PAC, a monthly plan, smooths the timing), what you buy and why, and when you look at it (once or twice a year, not every day). Never buy what you cannot explain, and check on Consob’s site that whoever sells it is authorised.',
            outcome: 'A written plan you follow for a year.',
            resources: [
              r(
                'Consob, investor education',
                'https://www.consob.it/web/investor-education',
              ),
            ],
          },
        ],
      },
      {
        id: 'house',
        title: 'House, mortgage and home bonuses',
        goal: 'Understand a mortgage and the tax bonuses before you sign anything.',
        steps: [
          {
            id: 'finance.house.mortgage',
            title: 'How a mortgage works',
            kind: 'learn',
            hours: 3,
            detail:
              'Fixed rate (same instalment for all the years) or variable (follows Euribor plus the bank’s spread). Compare offers by TAEG, the total yearly cost with fees and insurance, not by TAN alone. A common rule: the instalment should stay under a third of your net income. Interest on your main-home mortgage gives a 19% detrazione on up to €4,000 a year.',
            outcome:
              'You can compare two mortgage offers and know what you can afford.',
            resources: [
              r(
                'Banca d’Italia, L’economia per tutti (house and mortgage)',
                'https://economiapertutti.bancaditalia.it/',
              ),
            ],
          },
          {
            id: 'finance.house.bonuses',
            title: 'Bonus edilizi',
            kind: 'learn',
            hours: 2,
            detail:
              'Renovation and energy work on a home gives a detrazione spread over ten years: for expenses in 2025 and 2026, 50% on your main home and 36% on others, lower from 2027. It is lost if you pay the wrong way: use a "bonifico parlante" (a transfer naming the law, your codice fiscale and the firm’s VAT number) and keep the invoices. Log the work in the Houses renovations so the 730 finds every instalment.',
            outcome:
              'You know what a renovation will give back, and how to pay so it counts.',
            resources: [
              r(
                'Agenzia delle Entrate, home bonuses',
                'https://www.agenziaentrate.gov.it/',
              ),
              r(
                'ENEA, energy efficiency (ecobonus)',
                'https://www.efficienzaenergetica.enea.it/',
              ),
            ],
          },
        ],
      },
    ],
  },
];

export function learningPath(
  id: string,
  paths: readonly LearningPath[] = LEARNING_PATHS,
): LearningPath | undefined {
  return paths.find((path) => path.id === id);
}

/** Every step of a path, in order. */
export function pathSteps(path: LearningPath): PathStep[] {
  return path.stages.flatMap((stage) => [...stage.steps]);
}

/**
 * The path a step belongs to. A step id starts with its path's id
 * (`<path>.<stage>.<step>`), so a step the resource scout added, or one you
 * retired, still finds its path.
 */
export function pathOfStep(
  stepId: string,
  paths: readonly LearningPath[] = LEARNING_PATHS,
): LearningPath | undefined {
  return (
    paths.find((path) =>
      path.stages.some((stage) => stage.steps.some((s) => s.id === stepId)),
    ) ?? paths.find((path) => stepId.startsWith(`${path.id}.`))
  );
}

export function pathStep(
  stepId: string,
  paths: readonly LearningPath[] = LEARNING_PATHS,
): PathStep | undefined {
  for (const path of paths)
    for (const stage of path.stages)
      for (const step of stage.steps) if (step.id === stepId) return step;
  return undefined;
}

/**
 * What a path id may look like: lower case, digits and dashes, because a
 * step id starts with it (`<path>.<stage>.<step>`).
 */
export const PATH_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** A short id from a name: "Team leadership" → `team-leadership`. */
export function pathSlug(name: string, fallback = 'path'): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || fallback
  );
}

/** `base`, or `base-2`, `base-3`… whichever is not taken. */
export function freeId(base: string, taken: ReadonlySet<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function pathHours(path: LearningPath): number {
  return pathSteps(path).reduce((sum, step) => sum + step.hours, 0);
}
