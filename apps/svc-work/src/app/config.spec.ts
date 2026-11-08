import {
  DEFAULT_FEEDBACK_MODEL,
  LOCAL_WORK_DATABASE_URL,
  loadConfig,
} from './config.js';

describe('svc-work config', () => {
  it('runs locally on an .env made before Work existed', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3008);
    expect(config.natsUrl).toBe('nats://localhost:4222');
    expect(config.databaseUrl).toBe(LOCAL_WORK_DATABASE_URL);
    expect(config.ingestionUrl).toBe('http://localhost:3001');
    expect(config.anthropicApiKey).toBeNull();
    expect(config.feedbackModel).toBe(DEFAULT_FEEDBACK_MODEL);
  });

  it('takes what the environment sets, as in the containers', () => {
    const config = loadConfig({
      NATS_URL: 'nats://nats:4222',
      PORT: '3000',
      WORK_DATABASE_URL: 'postgres://work_svc:secret@postgres:5432/life_island',
      ANTHROPIC_API_KEY: ' sk-ant-test ',
    });
    expect(config.port).toBe(3000);
    expect(config.databaseUrl).toContain('@postgres:5432');
    expect(config.anthropicApiKey).toBe('sk-ant-test');
  });
});
