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
  'frameworks',
  'infrastructure',
  'leadership',
  '3d',
  'other',
] as const;
export type StudyTopic = (typeof STUDY_TOPICS)[number];

export const STUDY_TOPIC_LABELS: Record<StudyTopic, string> = {
  ai: 'AI coding',
  frameworks: 'Frameworks',
  infrastructure: 'Infrastructure',
  leadership: 'Leadership',
  '3d': '3D',
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

export interface PathStage {
  id: string;
  title: string;
  goal: string;
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
  level: 'beginner';
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
  // -------------------------------------------------------------------- AI
  {
    id: 'ai-coding',
    topic: 'ai',
    emblem: '✨',
    name: 'AI coding and tools',
    summary:
      'From how a language model works to agents, MCP, RAG and evals: code with AI every day, and build AI features that hold up.',
    why: 'Life Island already calls Claude from several modules. This path turns that into skill you own: you will understand every AI tool in Settings, write your own and measure it.',
    level: 'beginner',
    capstone:
      'An MCP server that lets Claude read your Life Island data (one module, read-only), with a small eval set that proves its answers.',
    certifications: [
      'Anthropic Academy course certificates (Claude Code in Action, Building with the Claude API, Introduction to MCP)',
    ],
    stages: [
      {
        id: 'foundations',
        title: 'How language models work',
        goal: 'Know what a model sees and why it answers the way it does.',
        steps: [
          {
            id: 'ai-coding.foundations.llm-basics',
            title: 'Tokens, context window and sampling',
            kind: 'learn',
            hours: 4,
            detail:
              'What a token is, why the context window limits what the model knows, what temperature changes, why the same prompt can answer differently, and what a model cannot know (anything after its training).',
            outcome:
              'You can explain why a long chat gets worse and why a model invents an API.',
            resources: [
              r(
                'Andrej Karpathy, Intro to Large Language Models (1 h video)',
                'https://www.youtube.com/watch?v=zjkBMFhNj_g',
              ),
              r(
                '3Blue1Brown, Neural networks (visual series)',
                'https://www.3blue1brown.com/topics/neural-networks',
              ),
            ],
          },
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
        ],
      },
      {
        id: 'daily',
        title: 'Coding with AI every day',
        goal: 'Make an AI coding agent part of your day, safely.',
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
        ],
      },
      {
        id: 'api',
        title: 'Building with the Claude API',
        goal: 'Call a model from your own code and control cost and shape.',
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
            title: 'Prompt caching, effort and cost',
            kind: 'practice',
            hours: 3,
            detail:
              'Cache a long system prompt, compare effort levels, and read the cost per use that Settings → AI tools shows for each tool.',
            outcome: 'You can halve the cost of a tool without losing quality.',
            resources: [
              r(
                'Claude docs, Prompt caching',
                'https://docs.claude.com/en/docs/build-with-claude/prompt-caching',
              ),
            ],
          },
        ],
      },
      {
        id: 'agents',
        title: 'Agents and MCP',
        goal: 'Know when an agent beats a fixed workflow, and connect tools to it.',
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
        ],
      },
      {
        id: 'rag',
        title: 'Your data: embeddings and RAG',
        goal: 'Let a model answer from documents it was never trained on.',
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
        ],
      },
      {
        id: 'production',
        title: 'Evals, safety and production',
        goal: 'Ship AI features you can trust and measure.',
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
              r(
                'Langfuse docs (tracing and evals)',
                'https://langfuse.com/docs',
              ),
            ],
          },
          {
            id: 'ai-coding.production.safety',
            title: 'Prompt injection and data safety',
            kind: 'learn',
            hours: 3,
            detail:
              'Why text inside a document must never be taken as an instruction, what to keep out of a prompt (tax codes, keys), and the OWASP list of LLM risks.',
            outcome:
              'You can spot the injection risk in a feature before it ships.',
            resources: [
              r(
                'OWASP Top 10 for LLM applications',
                'https://owasp.org/www-project-top-10-for-large-language-model-applications/',
              ),
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
];

export function learningPath(id: string): LearningPath | undefined {
  return LEARNING_PATHS.find((path) => path.id === id);
}

/** Every step of a path, in order. */
export function pathSteps(path: LearningPath): PathStep[] {
  return path.stages.flatMap((stage) => [...stage.steps]);
}

/** The path a step belongs to. */
export function pathOfStep(stepId: string): LearningPath | undefined {
  return LEARNING_PATHS.find((path) =>
    path.stages.some((stage) => stage.steps.some((s) => s.id === stepId)),
  );
}

export function pathStep(stepId: string): PathStep | undefined {
  for (const path of LEARNING_PATHS)
    for (const stage of path.stages)
      for (const step of stage.steps) if (step.id === stepId) return step;
  return undefined;
}

export function pathHours(path: LearningPath): number {
  return pathSteps(path).reduce((sum, step) => sum + step.hours, 0);
}
