import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import { randomBytes } from 'node:crypto';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { currentStep, totpCode } from './totp.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['AUTH_DATABASE_URL'];

describe.skipIf(!configured)(
  'Sign-in (owner, invite, two-factor, lockout over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    const saved = { ...process.env };
    const setupToken = randomBytes(24).toString('base64url');
    const suffix = randomBytes(4).toString('hex');
    const owner = {
      email: `owner-${suffix}@example.com`,
      name: 'Owner',
      password: 'tre gatti sul tetto',
    };

    const call = async (
      method: string,
      path: string,
      body?: unknown,
      cookie?: string,
    ) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      const set = response.headers.get('set-cookie');
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : undefined) as Record<string, unknown>,
        cookie: set ? set.split(';')[0] : undefined,
      };
    };

    beforeAll(async () => {
      // The real sign-in, not the dev bypass the other integration tests use.
      process.env['AUTH_DEV_BYPASS'] = 'false';
      process.env['INTERNAL_TOKEN'] = randomBytes(32).toString('base64url');
      const config = {
        ...loadConfig(),
        port: 0,
        setupToken,
        encryptionKey: randomBytes(32),
        cookieSecure: false,
        requireTwoFactor: false,
        loginPerMinute: 100,
        lockAfterFailures: 3,
      };
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'auth',
      });
      app = await createApp(config);
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      // A clean island: setup only works while there is no account.
      await svc.pool.query('delete from auth.users');
    });

    afterAll(async () => {
      await svc?.pool.query('delete from auth.users');
      await svc?.close();
      await app?.close();
      process.env = saved;
    });

    it('creates the owner once, with the setup code', async () => {
      expect((await call('GET', '/setup')).body).toEqual({ needed: true });
      expect(
        (await call('POST', '/setup', { ...owner, token: 'wrong' })).status,
      ).toBe(403);
      const created = await call('POST', '/setup', {
        ...owner,
        token: setupToken,
      });
      expect(created.status).toBe(200);
      expect(created.cookie).toMatch(/^li_session=/);
      const session = await call('GET', '/session', undefined, created.cookie);
      expect(session.body).toMatchObject({
        user: { email: owner.email, role: 'owner' },
        ready: true,
      });
      expect(
        (await call('POST', '/setup', { ...owner, token: setupToken })).status,
      ).toBe(409);
    });

    it('signs in, signs out, and refuses a wrong password', async () => {
      expect(
        (
          await call('POST', '/login', {
            email: owner.email,
            password: 'nope nope nope',
          })
        ).status,
      ).toBe(401);
      const signed = await call('POST', '/login', {
        email: owner.email.toUpperCase(),
        password: owner.password,
      });
      expect(signed.status).toBe(200);
      expect(
        (await call('POST', '/logout', undefined, signed.cookie)).status,
      ).toBe(204);
      expect(
        (await call('GET', '/session', undefined, signed.cookie)).status,
      ).toBe(401);
    });

    it('asks for the two-factor code once it is on', async () => {
      const signed = await call('POST', '/login', {
        email: owner.email,
        password: owner.password,
      });
      const started = await call(
        'POST',
        '/two-factor/start',
        undefined,
        signed.cookie,
      );
      const secret = started.body['secret'] as string;
      const code = totpCode(secret, currentStep());
      expect(
        (await call('POST', '/two-factor/confirm', { code }, signed.cookie))
          .status,
      ).toBe(200);
      expect(
        (
          await call('POST', '/login', {
            email: owner.email,
            password: owner.password,
          })
        ).body,
      ).toEqual({ needsCode: true });
      // The code used to confirm cannot be used again.
      expect(
        (
          await call('POST', '/login', {
            email: owner.email,
            password: owner.password,
            code,
          })
        ).status,
      ).toBe(401);
      const next = totpCode(secret, currentStep() + 1);
      expect(
        (
          await call('POST', '/login', {
            email: owner.email,
            password: owner.password,
            code: next,
          })
        ).status,
      ).toBe(200);
    });

    it('invites a member, who cannot manage people', async () => {
      await svc.pool.query(
        'update auth.users set failed_attempts = 0, locked_until = null',
      );
      const { rows } = await svc.pool.query<{ id: string }>(
        'select id from auth.users where role = $1',
        ['owner'],
      );
      // Sign in as the owner without the app: a session made directly.
      const ownerCookie = await sessionFor(rows[0]!.id);
      const invited = await call(
        'POST',
        '/invites',
        { email: `member-${suffix}@example.com` },
        ownerCookie,
      );
      expect(invited.status).toBe(201);
      const token = invited.body['token'] as string;
      expect((await call('GET', `/invite?token=${token}`)).body).toEqual({
        email: `member-${suffix}@example.com`,
      });
      const accepted = await call('POST', '/invite/accept', {
        token,
        name: 'Member',
        password: 'una casa sul lago',
      });
      expect(accepted.status).toBe(200);
      expect(
        (
          await call('POST', '/invite/accept', {
            token,
            name: 'Again',
            password: 'una casa sul lago',
          })
        ).status,
      ).toBe(404);
      expect(
        (await call('GET', '/members', undefined, accepted.cookie)).status,
      ).toBe(403);
      expect(
        (
          (await call('GET', '/members', undefined, ownerCookie))
            .body as unknown as unknown[]
        ).length,
      ).toBe(2);
    });

    it('locks an account after wrong attempts', async () => {
      const member = {
        email: `member-${suffix}@example.com`,
        password: 'una casa sul lago',
      };
      for (let i = 0; i < 3; i++)
        await call('POST', '/login', {
          email: member.email,
          password: 'wrong wrong wrong',
        });
      expect((await call('POST', '/login', member)).status).toBe(429);
    });

    async function sessionFor(userId: string): Promise<string> {
      const token = randomBytes(32).toString('base64url');
      const { createHash } = await import('node:crypto');
      await svc.pool.query(
        `insert into auth.sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`,
        [createHash('sha256').update(token).digest('hex'), userId],
      );
      return `li_session=${token}`;
    }
  },
);
