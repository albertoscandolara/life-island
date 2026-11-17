import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  DEV_OWNER,
  openSecret,
  sealSecret,
  withTransaction,
  type ServiceDb,
} from '@life-island/be-common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CONFIG, SERVICE_DB, type AuthConfig } from './config.js';
import {
  DECOY_HASH,
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyPassword,
} from './passwords.js';
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp.js';

/*
 * Accounts, sessions and invites of the island (docs/security.md, "Sign-in").
 * One household: the owner, and the people the owner invites; everyone sees
 * the same island, only the owner manages people.
 *
 * A session is a random 256-bit token in an HttpOnly cookie; only its SHA-256
 * is stored, so a copy of the database cannot be used to sign in.
 */

export type Role = 'owner' | 'member';

export interface Account {
  id: string;
  email: string;
  name: string;
  role: Role;
  twoFactor: boolean;
}

export interface SessionView {
  user: Account;
  /** False while a required second factor is missing: only sign-in pages work. */
  ready: boolean;
  twoFactorRequired: boolean;
  devBypass: boolean;
}

export interface Client {
  ip: string | null;
  userAgent: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  totp_last_step: string | null;
  failed_attempts: number;
  locked_until: Date | null;
  disabled_at: Date | null;
}

const DEV_ACCOUNT: Account = {
  id: DEV_OWNER.id,
  email: 'owner@localhost',
  name: 'Local owner',
  role: 'owner',
  twoFactor: false,
};

/** How often a session's last use is written (not on every request). */
const TOUCH_EVERY_MS = 5 * 60_000;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function account(row: UserRow): Account {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    twoFactor: row.totp_enabled,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(CONFIG) private readonly config: AuthConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject('DEV_BYPASS') private readonly devBypass: boolean,
  ) {}

  private get pool() {
    return this.svc.pool;
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  /** The session behind a cookie token, or null when it ended. */
  async session(token: string | null): Promise<SessionView | null> {
    if (this.devBypass)
      return {
        user: DEV_ACCOUNT,
        ready: true,
        twoFactorRequired: false,
        devBypass: true,
      };
    if (!token) return null;
    const { rows } = await this.pool.query<
      UserRow & { session_id: string; last_seen_at: Date }
    >(
      `select u.*, s.id as session_id, s.last_seen_at
         from auth.sessions s join auth.users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()
          and s.last_seen_at > now() - make_interval(hours => $2)
          and u.disabled_at is null`,
      [hashToken(token), this.config.sessionIdleHours],
    );
    const row = rows[0];
    if (!row) return null;
    if (Date.now() - row.last_seen_at.getTime() > TOUCH_EVERY_MS)
      await this.pool.query(
        'update auth.sessions set last_seen_at = now() where id = $1',
        [row.session_id],
      );
    return {
      user: account(row),
      ready: !this.config.requireTwoFactor || row.totp_enabled,
      twoFactorRequired: this.config.requireTwoFactor,
      devBypass: false,
    };
  }

  /** The signed-in account of a request, for the routes of this service. */
  async requireAccount(
    token: string | null,
    options: { ready?: boolean; owner?: boolean } = {},
  ): Promise<Account> {
    const view = await this.session(token);
    if (!view) throw new UnauthorizedException('Sign in to continue.');
    if (options.ready !== false && !view.ready)
      throw new ForbiddenException(
        'Finish setting up two-factor sign-in first.',
      );
    if (options.owner && view.user.role !== 'owner')
      throw new ForbiddenException('Only the owner of the island can do this.');
    return view.user;
  }

  private async startSession(userId: string, client: Client): Promise<string> {
    const token = newToken();
    await this.pool.query(
      `insert into auth.sessions (token_hash, user_id, expires_at, user_agent, ip)
       values ($1, $2, now() + make_interval(days => $3), $4, $5)`,
      [
        hashToken(token),
        userId,
        this.config.sessionMaxDays,
        client.userAgent?.slice(0, 300) ?? null,
        client.ip,
      ],
    );
    await this.pool.query(
      'update auth.users set last_login_at = now() where id = $1',
      [userId],
    );
    // Sessions that ended are cleaned up as new ones start.
    await this.pool.query(
      `delete from auth.sessions where expires_at < now() or last_seen_at < now() - make_interval(hours => $1)`,
      [this.config.sessionIdleHours],
    );
    return token;
  }

  async signOut(token: string | null): Promise<void> {
    if (token)
      await this.pool.query('delete from auth.sessions where token_hash = $1', [
        hashToken(token),
      ]);
  }

  async signOutEverywhere(token: string | null, client: Client): Promise<void> {
    const user = await this.requireAccount(token, { ready: false });
    await this.pool.query('delete from auth.sessions where user_id = $1', [
      user.id,
    ]);
    await this.audit(user.id, 'signed_out_everywhere', client);
  }

  // ── First owner ───────────────────────────────────────────────────────

  async setupNeeded(): Promise<boolean> {
    if (this.devBypass) return false;
    const { rows } = await this.pool.query<{ any: boolean }>(
      'select exists (select 1 from auth.users) as any',
    );
    return !rows[0]?.any;
  }

  /** Creates the owner account, once, with the setup token from the environment. */
  async setup(
    body: {
      token?: unknown;
      email?: unknown;
      name?: unknown;
      password?: unknown;
    },
    client: Client,
  ): Promise<{ token: string; user: Account }> {
    if (!this.config.setupToken)
      throw new ForbiddenException(
        'Set AUTH_SETUP_TOKEN on the server to create the owner account.',
      );
    if (
      typeof body.token !== 'string' ||
      !sameSecret(body.token, this.config.setupToken)
    ) {
      await this.audit(null, 'setup_refused', client);
      throw new ForbiddenException('The setup code is not right.');
    }
    const { email, name } = this.validIdentity(body);
    const problem = passwordProblem(body.password, email);
    if (problem) throw new BadRequestException(problem);
    const hash = await hashPassword(body.password as string);
    const user = await withTransaction(this.pool, async (db) => {
      // One owner, created once: the lock makes two setups at the same time impossible.
      await db.query('lock table auth.users in exclusive mode');
      const { rows: existing } = await db.query(
        'select 1 from auth.users limit 1',
      );
      if (existing.length)
        throw new ConflictException(
          'The island already has an owner. Sign in instead.',
        );
      const { rows } = await db.query<UserRow>(
        `insert into auth.users (email, name, role, password_hash) values ($1, $2, 'owner', $3) returning *`,
        [email, name, hash],
      );
      return rows[0] as UserRow;
    });
    await this.audit(user.id, 'owner_created', client);
    return {
      token: await this.startSession(user.id, client),
      user: account(user),
    };
  }

  // ── Sign-in ───────────────────────────────────────────────────────────

  async signIn(
    body: { email?: unknown; password?: unknown; code?: unknown },
    client: Client,
  ): Promise<{ token: string; user: Account } | { needsCode: true }> {
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const { rows } = await this.pool.query<UserRow>(
      'select * from auth.users where lower(email) = $1 and disabled_at is null',
      [email],
    );
    const user = rows[0];
    if (user?.locked_until && user.locked_until > new Date()) {
      // Still check the password, so a locked account answers as slowly as any other.
      await verifyPassword(password, DECOY_HASH);
      await this.audit(user.id, 'sign_in_locked', client);
      throw new HttpException(
        `Too many wrong attempts. Try again after ${user.locked_until.toISOString().slice(11, 16)} UTC.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const passwordOk = await verifyPassword(
      password,
      user?.password_hash ?? DECOY_HASH,
    );
    if (!user || !passwordOk) {
      if (user) await this.failed(user, client, 'wrong_password');
      else
        await this.audit(null, 'sign_in_unknown', client, email.slice(0, 200));
      throw new UnauthorizedException('Wrong email or password.');
    }
    if (user.totp_enabled) {
      if (body.code === undefined || body.code === '')
        return { needsCode: true };
      const step = this.checkCode(user, body.code);
      if (step === null) {
        await this.failed(user, client, 'wrong_code');
        throw new UnauthorizedException(
          'That code is not right, or it was already used.',
        );
      }
      await this.pool.query(
        'update auth.users set totp_last_step = $2 where id = $1',
        [user.id, step],
      );
    }
    const rehash = needsRehash(user.password_hash)
      ? await hashPassword(password)
      : null;
    await this.pool.query(
      `update auth.users set failed_attempts = 0, locked_until = null,
              password_hash = coalesce($2, password_hash), updated_at = now() where id = $1`,
      [user.id, rehash],
    );
    await this.audit(user.id, 'signed_in', client);
    return {
      token: await this.startSession(user.id, client),
      user: account(user),
    };
  }

  private async failed(
    user: UserRow,
    client: Client,
    event: string,
  ): Promise<void> {
    const attempts = user.failed_attempts + 1;
    const lock = attempts >= this.config.lockAfterFailures;
    await this.pool.query(
      `update auth.users set failed_attempts = $2,
              locked_until = case when $3 then now() + make_interval(mins => $4) else locked_until end
        where id = $1`,
      [user.id, lock ? 0 : attempts, lock, this.config.lockMinutes],
    );
    await this.audit(user.id, lock ? `${event}_locked` : event, client);
    if (lock)
      this.logger.warn(
        `Account ${user.id} locked for ${this.config.lockMinutes} minutes after wrong attempts`,
      );
  }

  // ── Password and two-factor ───────────────────────────────────────────

  async changePassword(
    token: string | null,
    body: { current?: unknown; next?: unknown },
    client: Client,
  ): Promise<{ token: string }> {
    const me = await this.requireAccount(token, { ready: false });
    const user = await this.userRow(me.id);
    if (
      typeof body.current !== 'string' ||
      !(await verifyPassword(body.current, user.password_hash))
    ) {
      await this.failed(user, client, 'wrong_password');
      throw new UnauthorizedException('Your current password is not right.');
    }
    const problem = passwordProblem(body.next, user.email);
    if (problem) throw new BadRequestException(problem);
    await this.pool.query(
      'update auth.users set password_hash = $2, updated_at = now() where id = $1',
      [user.id, await hashPassword(body.next as string)],
    );
    // Every other session ends; this browser gets a fresh one.
    await this.pool.query('delete from auth.sessions where user_id = $1', [
      user.id,
    ]);
    await this.audit(user.id, 'password_changed', client);
    return { token: await this.startSession(user.id, client) };
  }

  async startTwoFactor(
    token: string | null,
    client: Client,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const me = await this.requireAccount(token, { ready: false });
    if (me.twoFactor)
      throw new ConflictException(
        'Two-factor sign-in is already on. Turn it off first to change app.',
      );
    const key = this.encryptionKey();
    const secret = newTotpSecret();
    await this.pool.query(
      'update auth.users set totp_secret = $2, updated_at = now() where id = $1',
      [me.id, sealSecret(secret, key, me.id)],
    );
    await this.audit(me.id, 'two_factor_started', client);
    return { secret, otpauthUrl: otpauthUrl(secret, me.email) };
  }

  async confirmTwoFactor(
    token: string | null,
    body: { code?: unknown },
    client: Client,
  ): Promise<Account> {
    const me = await this.requireAccount(token, { ready: false });
    const user = await this.userRow(me.id);
    if (!user.totp_secret)
      throw new BadRequestException('Start the two-factor setup first.');
    const step = this.checkCode(user, body.code);
    if (step === null)
      throw new BadRequestException(
        'That code is not right. Check the time on your phone and try the next one.',
      );
    const { rows } = await this.pool.query<UserRow>(
      'update auth.users set totp_enabled = true, totp_last_step = $2, updated_at = now() where id = $1 returning *',
      [user.id, step],
    );
    await this.audit(user.id, 'two_factor_enabled', client);
    return account(rows[0] as UserRow);
  }

  async disableTwoFactor(
    token: string | null,
    body: { password?: unknown; code?: unknown },
    client: Client,
  ): Promise<Account> {
    const me = await this.requireAccount(token);
    if (this.config.requireTwoFactor)
      throw new ForbiddenException(
        'Two-factor sign-in is required on this island. Set up a new app instead.',
      );
    const user = await this.userRow(me.id);
    const passwordOk =
      typeof body.password === 'string' &&
      (await verifyPassword(body.password, user.password_hash));
    if (!passwordOk || this.checkCode(user, body.code) === null) {
      await this.failed(user, client, 'two_factor_disable_refused');
      throw new UnauthorizedException('Your password or code is not right.');
    }
    const { rows } = await this.pool.query<UserRow>(
      `update auth.users set totp_enabled = false, totp_secret = null, totp_last_step = null, updated_at = now()
        where id = $1 returning *`,
      [user.id],
    );
    await this.audit(user.id, 'two_factor_disabled', client);
    return account(rows[0] as UserRow);
  }

  private checkCode(user: UserRow, code: unknown): number | null {
    if (!user.totp_secret) return null;
    let secret: string;
    try {
      secret = openSecret(user.totp_secret, this.encryptionKey(), user.id);
    } catch (error) {
      this.logger.error(
        `Cannot open the two-factor seed of ${user.id}: ${String(error)}`,
      );
      throw new ServiceUnavailableException(
        'Two-factor sign-in is not available: the server key changed.',
      );
    }
    return verifyTotp(
      secret,
      code,
      user.totp_last_step === null ? null : Number(user.totp_last_step),
    );
  }

  private encryptionKey(): Buffer {
    if (!this.config.encryptionKey)
      throw new ServiceUnavailableException(
        'Set AUTH_ENCRYPTION_KEY on the server to use two-factor sign-in.',
      );
    return this.config.encryptionKey;
  }

  // ── People and invites (owner only) ───────────────────────────────────

  async members(
    token: string | null,
  ): Promise<(Account & { lastLoginAt: string | null })[]> {
    await this.requireAccount(token, { owner: true });
    const { rows } = await this.pool.query<
      UserRow & { last_login_at: Date | null }
    >('select * from auth.users where disabled_at is null order by created_at');
    return rows.map((row) => ({
      ...account(row),
      lastLoginAt: row.last_login_at?.toISOString() ?? null,
    }));
  }

  async removeMember(
    token: string | null,
    id: string,
    client: Client,
  ): Promise<void> {
    const me = await this.requireAccount(token, { owner: true });
    if (id === me.id)
      throw new BadRequestException('You cannot remove yourself.');
    const { rowCount } = await this.pool.query(
      'update auth.users set disabled_at = now(), updated_at = now() where id = $1 and disabled_at is null',
      [id],
    );
    if (!rowCount) throw new NotFoundException('Person not found.');
    await this.pool.query('delete from auth.sessions where user_id = $1', [id]);
    await this.audit(me.id, 'member_removed', client, id);
  }

  async invites(token: string | null) {
    await this.requireAccount(token, { owner: true });
    const { rows } = await this.pool.query<{
      id: string;
      email: string;
      role: Role;
      expires_at: Date;
    }>(
      'select id, email, role, expires_at from auth.invites where used_at is null and expires_at > now() order by created_at desc',
    );
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at.toISOString(),
    }));
  }

  /** A one-time invite; the token is shown once and only its hash is kept. */
  async invite(
    token: string | null,
    body: { email?: unknown; role?: unknown },
    client: Client,
  ): Promise<{ token: string; expiresAt: string }> {
    const me = await this.requireAccount(token, { owner: true });
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL.test(email))
      throw new BadRequestException('Enter a valid email.');
    const role: Role = body.role === 'owner' ? 'owner' : 'member';
    const { rows: taken } = await this.pool.query(
      'select 1 from auth.users where lower(email) = $1 and disabled_at is null',
      [email],
    );
    if (taken.length)
      throw new ConflictException(
        'Someone with this email already has an account.',
      );
    const invite = newToken();
    const { rows } = await this.pool.query<{ expires_at: Date }>(
      `insert into auth.invites (token_hash, email, role, created_by, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(days => $5)) returning expires_at`,
      [hashToken(invite), email, role, me.id, this.config.inviteDays],
    );
    await this.audit(me.id, 'invite_created', client, email);
    return {
      token: invite,
      expiresAt: (rows[0] as { expires_at: Date }).expires_at.toISOString(),
    };
  }

  async cancelInvite(
    token: string | null,
    id: string,
    client: Client,
  ): Promise<void> {
    const me = await this.requireAccount(token, { owner: true });
    await this.pool.query(
      'delete from auth.invites where id = $1 and used_at is null',
      [id],
    );
    await this.audit(me.id, 'invite_cancelled', client, id);
  }

  /** The email an invite is for, while it can still be used. */
  async checkInvite(invite: unknown): Promise<{ email: string }> {
    const row =
      typeof invite === 'string'
        ? await this.openInvite(this.pool, invite)
        : null;
    if (!row)
      throw new NotFoundException(
        'This invite was used, cancelled or has expired. Ask for a new one.',
      );
    return { email: row.email };
  }

  async acceptInvite(
    body: { token?: unknown; name?: unknown; password?: unknown },
    client: Client,
  ): Promise<{ token: string; user: Account }> {
    if (typeof body.token !== 'string')
      throw new BadRequestException('The invite link is not complete.');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120)
      throw new BadRequestException('Enter your name.');
    const user = await withTransaction(this.pool, async (db) => {
      const invite = await this.openInvite(db, body.token as string, true);
      if (!invite)
        throw new NotFoundException(
          'This invite was used, cancelled or has expired. Ask for a new one.',
        );
      const problem = passwordProblem(body.password, invite.email);
      if (problem) throw new BadRequestException(problem);
      const { rows: taken } = await db.query(
        'select 1 from auth.users where lower(email) = $1 and disabled_at is null',
        [invite.email],
      );
      if (taken.length)
        throw new ConflictException(
          'Someone with this email already has an account.',
        );
      await db.query('update auth.invites set used_at = now() where id = $1', [
        invite.id,
      ]);
      const { rows } = await db.query<UserRow>(
        `insert into auth.users (email, name, role, password_hash) values ($1, $2, $3, $4)
         on conflict (lower(email)) do update set name = excluded.name, role = excluded.role,
           password_hash = excluded.password_hash, totp_secret = null, totp_enabled = false,
           totp_last_step = null, failed_attempts = 0, locked_until = null, disabled_at = null, updated_at = now()
         returning *`,
        [
          invite.email,
          name,
          invite.role,
          await hashPassword(body.password as string),
        ],
      );
      return rows[0] as UserRow;
    });
    await this.audit(user.id, 'invite_accepted', client);
    return {
      token: await this.startSession(user.id, client),
      user: account(user),
    };
  }

  private async openInvite(
    db: { query: ServiceDb['pool']['query'] },
    invite: string,
    lock = false,
  ): Promise<{ id: string; email: string; role: Role } | null> {
    const { rows } = await db.query<{ id: string; email: string; role: Role }>(
      `select id, email, role from auth.invites
        where token_hash = $1 and used_at is null and expires_at > now()${lock ? ' for update' : ''}`,
      [hashToken(invite)],
    );
    return rows[0] ?? null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private validIdentity(body: { email?: unknown; name?: unknown }): {
    email: string;
    name: string;
  } {
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!EMAIL.test(email))
      throw new BadRequestException('Enter a valid email.');
    if (!name || name.length > 120)
      throw new BadRequestException('Enter your name.');
    return { email, name };
  }

  private async userRow(id: string): Promise<UserRow> {
    const { rows } = await this.pool.query<UserRow>(
      'select * from auth.users where id = $1',
      [id],
    );
    if (!rows[0]) throw new UnauthorizedException('Sign in to continue.');
    return rows[0];
  }

  private async audit(
    userId: string | null,
    event: string,
    client: Client,
    detail?: string,
  ): Promise<void> {
    await this.pool
      .query(
        'insert into auth.audit (user_id, event, ip, detail) values ($1, $2, $3, $4)',
        [
          userId,
          event,
          client.ip?.slice(0, 64) ?? null,
          detail?.slice(0, 300) ?? null,
        ],
      )
      .catch((error: unknown) =>
        this.logger.warn(`Could not write the audit row: ${String(error)}`),
      );
  }
}

function sameSecret(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
