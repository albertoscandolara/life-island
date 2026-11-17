import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { refuseDevSecretsInProduction } from '@life-island/be-common';
import { loadConfig } from './app/config.js';
import { WorkerModule } from './app/worker.module.js';

const config = loadConfig();
refuseDevSecretsInProduction('svc-parse-worker', config);
const app = await NestFactory.createApplicationContext(
  WorkerModule.forRoot(config),
);
app.enableShutdownHooks();
await app.init();
Logger.log(
  `svc-parse-worker started with the ${config.parser} parser`,
  'Bootstrap',
);
