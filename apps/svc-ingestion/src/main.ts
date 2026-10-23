import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app/bootstrap.js';
import { loadConfig } from './app/config.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.port);
Logger.log(`svc-ingestion listening on :${config.port}`, 'Bootstrap');
