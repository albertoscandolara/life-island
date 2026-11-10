import { LOCAL_SETTINGS_DATABASE_URL, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('runs on the local stack with no settings in .env', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3009);
    expect(config.databaseUrl).toBe(LOCAL_SETTINGS_DATABASE_URL);
    expect(config.natsUrl).toBe('nats://localhost:4222');
  });

  it('takes SETTINGS_PORT over PORT', () => {
    expect(loadConfig({ PORT: '3000', SETTINGS_PORT: '4000' }).port).toBe(4000);
    expect(loadConfig({ PORT: '3000' }).port).toBe(3000);
  });
});
