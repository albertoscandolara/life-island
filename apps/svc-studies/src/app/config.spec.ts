import {
  DEFAULT_COACH_MODEL,
  LOCAL_STUDIES_DATABASE_URL,
  loadConfig,
} from './config.js';

describe('loadConfig', () => {
  it('runs on the local stack with no studies settings in .env', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3010);
    expect(config.databaseUrl).toBe(LOCAL_STUDIES_DATABASE_URL);
    expect(config.anthropicApiKey).toBeNull();
    expect(config.coachModel).toBe(DEFAULT_COACH_MODEL);
  });

  it('takes STUDIES_PORT over PORT, and the model from STUDIES_AI_MODEL', () => {
    expect(loadConfig({ PORT: '3000', STUDIES_PORT: '4000' }).port).toBe(4000);
    expect(loadConfig({ PORT: '3000' }).port).toBe(3000);
    expect(
      loadConfig({ STUDIES_AI_MODEL: 'claude-haiku-5-5' }).coachModel,
    ).toBe('claude-haiku-5-5');
  });
});
