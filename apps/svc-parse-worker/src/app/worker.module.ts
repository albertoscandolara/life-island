import Anthropic from '@anthropic-ai/sdk';
import { Module, type DynamicModule } from '@nestjs/common';
import {
  createServiceDb,
  ObjectStorage,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import {
  CONFIG,
  PARSER,
  SERVICE_DB,
  STORAGE,
  type WorkerConfig,
} from './config.js';
import { ParseService } from './parse.service.js';
import { ClaudeParser } from './parsers/claude-parser.js';
import type { DocumentParser } from './parsers/document-parser.js';
import { FakeParser } from './parsers/fake-parser.js';
import { ParseScheduler } from './scheduler.js';

function createParser(config: WorkerConfig): DocumentParser {
  if (config.parser === 'fake') return new FakeParser();
  return new ClaudeParser(new Anthropic(), {
    classify: config.classifyModel,
    extract: config.extractModel,
  });
}

/** No HTTP: the worker only talks to its database, object storage and NATS. */
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
        { provide: PARSER, useValue: createParser(config) },
        ParseService,
        ParseScheduler,
        {
          provide: EventsRuntime,
          useFactory: (db: ServiceDb) =>
            new EventsRuntime({
              pool: db.pool,
              natsUrl: config.natsUrl,
              schema: db.schema,
              serviceName: 'svc-parse-worker',
            }),
          inject: [SERVICE_DB],
        },
      ],
    };
  }
}
