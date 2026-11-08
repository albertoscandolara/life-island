import { LOCAL_CARS_DATABASE_URL, loadConfig } from './config.js';

describe('svc-cars config', () => {
  it('runs locally on an .env made before Cars existed', () => {
    const config = loadConfig({ NATS_URL: 'nats://localhost:4222' });
    expect(config.port).toBe(3007);
    expect(config.databaseUrl).toBe(LOCAL_CARS_DATABASE_URL);
    expect(config.storage).toBeNull();
  });

  it('takes what the environment sets, as in the containers', () => {
    const config = loadConfig({
      NATS_URL: 'nats://nats:4222',
      PORT: '3000',
      CARS_DATABASE_URL: 'postgres://cars_svc:secret@postgres:5432/life_island',
    });
    expect(config.port).toBe(3000);
    expect(config.databaseUrl).toContain('@postgres:5432');
  });
});
