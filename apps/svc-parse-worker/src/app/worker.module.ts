import Anthropic from '@anthropic-ai/sdk';
import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  createServiceDb,
  describeAiTools,
  ObjectStorage,
  settingChangedHandler,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import { SETTING_CHANGED_EVENT } from '@life-island/contracts';
import {
  CONFIG,
  PARSER,
  SERVICE_DB,
  STORAGE,
  type WorkerConfig,
} from './config.js';
import { ParseService } from './parse.service.js';
import {
  ClaudeParser,
  describeClaudeParser,
  type ClaudeModels,
} from './parsers/claude-parser.js';
import type { DocumentAnalyzer } from './parsers/document-parser.js';
import { FakeParser } from './parsers/fake-parser.js';
import { GatedAnalyzer } from './parsers/gated-analyzer.js';
import { ParseScheduler } from './scheduler.js';
import { ReclassificationScheduler } from './historical/reclassification.scheduler.js';
import { ReclassificationService } from './historical/reclassification.service.js';

function modelsOf(config: WorkerConfig): ClaudeModels {
  return {
    classify: config.classifyModel,
    extract: config.extractModel,
    discover: config.discoverModel,
    reclassify: config.reclassifyModel,
  };
}

function createParser(config: WorkerConfig, svc: ServiceDb): DocumentAnalyzer {
  const offline = new FakeParser({
    steps: config.fakeQuotaSteps,
    periodMinutes: config.fakeQuotaPeriodMinutes,
  });
  if (config.parser === 'fake') return offline;
  // The SDK retries 408/409/429/5xx twice, honouring retry-after; usage-quota
  // errors (400/402) are not retried, so an exhausted quota is never hammered.
  const client = new Anthropic({ maxRetries: 2 });
  const models = modelsOf(config);
  const options = { chunkChars: config.chunkChars };
  const claude = new ClaudeParser(client, models, options);
  // Each step asks Settings' switches first; a step turned off runs offline.
  // A model picked in Settings replaces the env one for that tool's calls.
  return new GatedAnalyzer(
    claude,
    new FakeParser(),
    svc,
    (toolId, model) =>
      new ClaudeParser(
        client,
        { ...models, [TOOL_MODELS[toolId]]: model },
        options,
      ),
  );
}

/** Which of the parser's models each document AI tool uses. */
const TOOL_MODELS: Record<string, keyof ClaudeModels> = {
  'documents.classify': 'classify',
  'documents.discover': 'discover',
  'documents.extract': 'extract',
  'documents.transactions': 'transaction',
  'documents.reclassify': 'reclassify',
};

const logger = new Logger('Settings');

/** Tells Settings how each document AI tool calls the model, for its info button. */
@Injectable()
class AiToolsReporter implements OnApplicationBootstrap {
  constructor(
    @Inject(CONFIG) private readonly config: WorkerConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await describeAiTools(
      this.svc.pool,
      this.svc.schema,
      'svc-parse-worker',
      describeClaudeParser(
        modelsOf(this.config),
        this.config.parser === 'claude',
      ),
    ).catch((error: unknown) =>
      logger.warn(`Could not describe the AI tools: ${String(error)}`),
    );
  }
}

/**
 * No HTTP: the worker only talks to its database, object storage and NATS.
 * Settings reach it as events (its `settings_replica`), never by a call.
 */
@Module({})
export class WorkerModule {
  static forRoot(config: WorkerConfig): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'ingestion',
    });
    return {
      module: WorkerModule,
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        { provide: STORAGE, useValue: new ObjectStorage(config.storage) },
        { provide: PARSER, useValue: createParser(config, svc) },
        AiToolsReporter,
        ParseService,
        ParseScheduler,
        ReclassificationService,
        ReclassificationScheduler,
        {
          provide: EventsRuntime,
          useFactory: (db: ServiceDb) =>
            new EventsRuntime({
              pool: db.pool,
              natsUrl: config.natsUrl,
              schema: db.schema,
              serviceName: 'svc-parse-worker',
              // The switches of the document AI tools and the other settings
              // the worker reads, kept in its own replica.
              onConnected: async (nats) => {
                await startEventConsumer({
                  pool: db.pool,
                  nats,
                  schema: db.schema,
                  durableName: 'parse-worker-settings',
                  eventTypes: [SETTING_CHANGED_EVENT],
                  handle: settingChangedHandler(db.schema),
                  onError: (error, subject) =>
                    logger.error(
                      `Failed to apply ${subject}: ${String(error)}`,
                    ),
                });
              },
            }),
          inject: [SERVICE_DB],
        },
      ],
    };
  }
}
