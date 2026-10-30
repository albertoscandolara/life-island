import { loadConfig, scheduleToCron } from './config.js';

describe('worker config', () => {
  const env = {
    INGESTION_DATABASE_URL: 'postgres://x',
    NATS_URL: 'nats://x',
    S3_ENDPOINT: 'http://x',
    S3_ACCESS_KEY: 'a',
    S3_SECRET_KEY: 'b',
  };

  it('runs every day at 06:00 unless configured otherwise', () => {
    expect(loadConfig(env).schedule).toBe('0 6 * * *');
    expect(loadConfig({ ...env, PARSE_SCHEDULE: '07:30' }).schedule).toBe(
      '30 7 * * *',
    );
    expect(loadConfig({ ...env, PARSE_SCHEDULE: '0 */6 * * *' }).schedule).toBe(
      '0 */6 * * *',
    );
  });

  it('rejects an impossible time of day', () => {
    expect(() => scheduleToCron('25:00')).toThrow('not a valid time of day');
  });

  it('keeps category suggestions for approval unless auto-approval is on', () => {
    expect(loadConfig(env).autoApproveCategories).toBe(false);
    expect(
      loadConfig({ ...env, CATEGORY_AUTO_APPROVE: 'true' })
        .autoApproveCategories,
    ).toBe(true);
  });
});
