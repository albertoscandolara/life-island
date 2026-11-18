import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  enqueueEvent,
  withTransaction,
  type ServiceDb,
} from '@life-island/be-common';
import {
  euroText,
  guessMoneyCategory,
  isoAddDays,
  isoToday,
  linkProblem,
  PAYABLE_SOURCES,
  PAYMENT_LINKED_EVENT,
  PAYMENT_UNLINKED_EVENT,
  payableModule,
  rejectionKey,
  remaining,
  suggestMatches,
  transactionRequestSchema,
  type LifeAttentionItemDto,
  type MatchesDto,
  type MatchLink,
  type MatchLinkRequest,
  type MatchMovementDto,
  type MatchRejectRequest,
  type MovementLinkDto,
  type PayableDto,
  type PaymentLinkedV1,
  type PaymentUnlinkedV1,
} from '@life-island/contracts';
import type pg from 'pg';
import { SERVICE_DB, type ServiceConfig } from '../config.js';
import { readPayables, type PayablesRead } from './payable-reader.js';

/*
 * Money matching (docs/guides/money-matching.md). Money proposes which bank
 * movement paid which item of another area; you confirm, and only then is a
 * link saved and the area told (money.payment_linked@1, through the outbox,
 * in the same transaction). Every link is checked against both amounts while
 * the movement and the items are locked, so two confirmations at once can
 * never pay an item twice or spend a movement twice.
 */

function today(): string {
  return isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
}

/** How far back the "To match" tab looks for movements. */
export const MATCH_LOOKBACK_DAYS = 120;
/** How long a read of the areas is reused for the attention badge. */
const ATTENTION_CACHE_MS = 60_000;

/** The way to read the areas' payables: HTTP by default, a stub in tests. */
export const PAYABLES_READER = Symbol('PayablesReader');
export type PayablesReader = (query: {
  from: string;
  to: string;
}) => Promise<PayablesRead>;

interface MovementRow {
  id: string;
  date: string;
  amount: number;
  description: string;
  accountName: string;
}

interface LinkRow {
  id: string;
  movementId: string;
  payableKey: string;
  module: string;
  amount: number;
  title: string;
  path: string | null;
  auto: boolean;
  createdAt: string;
}

const LINK_COLUMNS = `l.id, l.transaction_id as "movementId", l.payable_key as "payableKey",
  l.module, l.amount::float8 as amount, l.title, l.path, l.auto,
  to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt"`;

const MOVEMENT_COLUMNS = `t.id, t.date::text as date, t.amount::float8 as amount,
  t.description, a.name as "accountName"`;

@Injectable()
export class MatchingService {
  private attentionCache: {
    at: number;
    day: string;
    ready: number;
    items: LifeAttentionItemDto[];
  } | null = null;

  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(PAYABLES_READER) private readonly reader: PayablesReader,
  ) {}

  /** The default reader: every area in PAYABLE_SOURCES, over HTTP. */
  static httpReader(config: ServiceConfig): PayablesReader {
    return (query) => readPayables(config.payableSources, query);
  }

  /**
   * What Money proposes for the movements of the last months. A sure match
   * of an item paid automatically (a direct debit, a card on file) is linked
   * first, on its own: you see it under the links, and can undo it.
   */
  async matches(day = today()): Promise<MatchesDto> {
    const first = await this.read(day);
    const automatic = first.suggestions.filter((s) => {
      const payable = first.payables.find((p) => p.key === s.payableKeys[0]);
      return (
        s.confidence === 'sure' &&
        s.payableKeys.length === 1 &&
        payable?.autoPay === true
      );
    });
    if (!automatic.length) return first;
    for (const s of automatic)
      // Another request may have linked it meanwhile, or the area changed:
      // the pair is simply proposed again next time.
      await this.link(
        {
          movementId: s.movementId,
          items: [{ payableKey: s.payableKeys[0], amount: s.amounts[0] }],
        },
        true,
      ).catch(() => undefined);
    return this.read(day);
  }

  private async read(day: string): Promise<MatchesDto> {
    const from = isoAddDays(day, -MATCH_LOOKBACK_DAYS);
    const to = day;
    const [movementRows, links, rejected, read] = await Promise.all([
      this.svc.pool.query<MovementRow>(
        `select ${MOVEMENT_COLUMNS} from money.transactions t
           join money.accounts a on a.id = t.account_id
          where t.date between $1 and $2
          order by t.date desc, t.created_at desc`,
        [from, to],
      ),
      this.allLinks(),
      this.svc.pool.query<{ movementId: string; payableKey: string }>(
        `select r.transaction_id as "movementId", r.payable_key as "payableKey"
           from money.match_rejections r
           join money.transactions t on t.id = r.transaction_id
          where t.date between $1 and $2`,
        [from, to],
      ),
      this.reader({ from, to }),
    ]);
    const movements = movementRows.rows;
    const suggestions = suggestMatches(
      movements,
      read.payables,
      links,
      new Set(
        rejected.rows.map((r) => rejectionKey(r.movementId, r.payableKey)),
      ),
    );
    const inWindow = new Set(movements.map((m) => m.id));
    const linkedOf = (pick: (l: MatchLink) => boolean) =>
      links.filter(pick).reduce((sum, l) => sum + l.amount, 0);
    const source = (module: string) =>
      PAYABLE_SOURCES.find((s) => s.module === module);
    return {
      from,
      to,
      suggestions,
      movements: movements.map((m): MatchMovementDto => ({
        ...m,
        linked: round(linkedOf((l) => l.movementId === m.id)),
      })),
      payables: read.payables.map((p) => ({
        ...p,
        areaName: source(p.module)?.name ?? p.module,
        emblem: source(p.module)?.emblem ?? '•',
        linked: round(linkedOf((l) => l.payableKey === p.key)),
      })),
      links: links
        .filter((l) => inWindow.has(l.movementId))
        .map((l) => ({ ...l, status: linkStatus(l, links, read) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      sources: read.sources,
    };
  }

  /**
   * The undated things Money's matching needs you for: the payments it is
   * sure or nearly sure of, waiting for your yes. Reused for a minute, so
   * the island's badges do not ask every area each time.
   */
  async attention(
    day = today(),
  ): Promise<{ ready: number; items: LifeAttentionItemDto[] }> {
    const cached = this.attentionCache;
    if (
      cached &&
      cached.day === day &&
      Date.now() - cached.at < ATTENTION_CACHE_MS
    )
      return cached;
    const matches = await this.matches(day);
    const ready = matches.suggestions.filter(
      (s) => s.confidence !== 'check',
    ).length;
    const items: LifeAttentionItemDto[] = ready
      ? [
          {
            id: 'match:payments',
            kind: 'match',
            title:
              ready === 1
                ? 'Confirm a payment found in your bank movements'
                : `Confirm ${ready} payments found in your bank movements`,
            detail:
              'Each one marks a bill or an expense as paid in its own area.',
            since: null,
            path: '/money?tab=match',
            action: 'Confirm',
          },
        ]
      : [];
    this.attentionCache = { at: Date.now(), day, ready, items };
    return this.attentionCache;
  }

  /**
   * You confirm that a movement paid one or more items. All the links are
   * saved and announced together, or none is.
   */
  async link(
    request: MatchLinkRequest,
    auto = false,
  ): Promise<MovementLinkDto[]> {
    // Read the areas first, outside the transaction: no lock is held while
    // waiting on the network. The movement is read again under its lock.
    const before = await this.movement(this.svc.pool, request.movementId);
    if (!before) throw new NotFoundException('Movement not found');
    const keys = request.items.map((i) => i.payableKey);
    for (const key of keys)
      if (!PAYABLE_SOURCES.some((s) => s.module === payableModule(key)))
        throw new BadRequestException(`${key} is not an item Money can link`);
    const read = await this.reader({ from: before.date, to: before.date });
    for (const key of keys) {
      const status = read.sources.find((s) => s.module === payableModule(key));
      if (!status?.ok)
        throw new ServiceUnavailableException(
          `${status?.name ?? payableModule(key)} did not answer, so the item cannot be checked. Try again in a moment.`,
        );
    }
    const payables = new Map(read.payables.map((p) => [p.key, p]));

    const created = await withTransaction(this.svc.pool, async (client) => {
      const movement = await this.movement(client, request.movementId, true);
      if (!movement) throw new NotFoundException('Movement not found');
      if (movement.date !== before.date || movement.amount !== before.amount)
        throw new ConflictException(
          'The movement changed while you were confirming. Look again.',
        );
      // One lock per item, always in the same order: no two confirmations
      // can add up links of the same item at the same time.
      for (const key of [...keys].sort())
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [
          `money.payable:${key}`,
        ]);

      for (const item of request.items) {
        const payable = payables.get(item.payableKey);
        if (!payable)
          throw new ConflictException(
            'That item is not listed for the day of this movement any more. Look again.',
          );
        if ((payable.direction === 'out') !== movement.amount < 0)
          throw new BadRequestException(
            payable.direction === 'out'
              ? 'This item is money going out, the movement is money coming in.'
              : 'This item is money coming in, the movement is money going out.',
          );
      }

      const existing = await this.links(
        client,
        `l.transaction_id = $1 or l.payable_key = any($2)`,
        [movement.id, keys],
      );
      for (const key of keys)
        if (
          existing.some(
            (l) => l.movementId === movement.id && l.payableKey === key,
          )
        )
          throw new ConflictException(
            'This movement is already linked to that item.',
          );
      const proposed: MatchLink[] = [
        ...existing,
        ...request.items.map((i) => ({
          movementId: movement.id,
          payableKey: i.payableKey,
          amount: i.amount,
        })),
      ];
      const others = await client.query<{ id: string; amount: number }>(
        `select id, amount::float8 as amount from money.transactions where id = any($1)`,
        [[...new Set(proposed.map((l) => l.movementId))]],
      );
      const problem = linkProblem(
        proposed,
        new Map(
          others.rows.map((m) => [
            m.id,
            { id: m.id, amount: m.amount, date: '', description: '' },
          ]),
        ),
        payables,
      );
      if (problem) throw new ConflictException(problem);

      const saved: LinkRow[] = [];
      for (const item of request.items) {
        const payable = payables.get(item.payableKey) as PayableDto;
        const [row] = await this.links(
          client,
          null,
          [
            movement.id,
            item.payableKey,
            payable.module,
            round(item.amount),
            payable.title,
            payable.path,
            auto,
          ],
          `insert into money.movement_links as l
             (transaction_id, payable_key, module, amount, title, path, auto)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning ${LINK_COLUMNS}`,
        );
        saved.push(row);
        const event: PaymentLinkedV1 = {
          linkId: row.id,
          payableKey: row.payableKey,
          module: row.module,
          movementId: movement.id,
          date: movement.date,
          amount: row.amount,
          accountName: movement.accountName,
          description: movement.description,
          linkedAt: row.createdAt,
        };
        await enqueueEvent(client, this.svc.schema, {
          type: PAYMENT_LINKED_EVENT,
          payload: event,
        });
      }
      // A pair you once said "not this one" to, and now confirmed.
      await client.query(
        `delete from money.match_rejections
          where transaction_id = $1 and payable_key = any($2)`,
        [movement.id, keys],
      );
      return saved;
    });
    this.attentionCache = null;
    return created.map((l) => ({ ...l, status: 'ok' }));
  }

  /**
   * You undo a link: the area forgets that payment. Undoing one Money made
   * on its own also says "not this one", so it is never made again.
   */
  async unlink(linkId: string): Promise<void> {
    const removed = await withTransaction(this.svc.pool, async (client) => {
      const rows = await this.removeLinks(
        client,
        'l.id = $1',
        [linkId],
        'undone',
      );
      for (const row of rows.filter((r) => r.auto))
        await client.query(
          `insert into money.match_rejections (transaction_id, payable_key)
           values ($1, $2) on conflict do nothing`,
          [row.movementId, row.payableKey],
        );
      return rows.length;
    });
    if (!removed) throw new NotFoundException('Link not found');
    this.attentionCache = null;
  }

  /** "Not this one": the pairs are never proposed again. */
  async reject(request: MatchRejectRequest): Promise<void> {
    const movement = await this.movement(this.svc.pool, request.movementId);
    if (!movement) throw new NotFoundException('Movement not found');
    await this.svc.pool.query(
      `insert into money.match_rejections (transaction_id, payable_key)
       select $1, unnest($2::text[])
       on conflict do nothing`,
      [movement.id, request.payableKeys],
    );
    this.attentionCache = null;
  }

  /** Removes a movement, undoing its links first (and telling their areas). */
  async removeMovement(id: string): Promise<void> {
    await withTransaction(this.svc.pool, async (client) => {
      const movement = await this.movement(client, id, true);
      if (!movement) throw new NotFoundException('Movement not found');
      await this.removeLinks(
        client,
        'l.transaction_id = $1',
        [id],
        'movement-removed',
      );
      await client.query('delete from money.transactions where id = $1', [id]);
    });
    this.attentionCache = null;
  }

  /** Removes an account and its movements, undoing their links first. */
  async removeAccount(id: string): Promise<void> {
    await withTransaction(this.svc.pool, async (client) => {
      const { rowCount } = await client.query(
        'select id from money.accounts where id = $1 for update',
        [id],
      );
      if (!rowCount) throw new NotFoundException('Account not found');
      // Lock its movements, so none gains a link while it goes.
      await client.query(
        'select id from money.transactions where account_id = $1 for update',
        [id],
      );
      await this.removeLinks(
        client,
        'l.transaction_id in (select id from money.transactions where account_id = $1)',
        [id],
        'movement-removed',
      );
      await client.query('delete from money.accounts where id = $1', [id]);
    });
    this.attentionCache = null;
  }

  /**
   * Changes a movement. A linked movement keeps its direction and never
   * moves less than what is linked to it; undo a link first to go below.
   */
  async updateMovement(id: string, body: unknown): Promise<void> {
    const parsed = transactionRequestSchema.partial().safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join('; '),
      );
    const request = parsed.data;
    await withTransaction(this.svc.pool, async (client) => {
      const movement = await this.movement(client, id, true);
      if (!movement) throw new NotFoundException('Movement not found');
      if (request.accountId) {
        const { rowCount } = await client.query(
          'select 1 from money.accounts where id = $1',
          [request.accountId],
        );
        if (!rowCount) throw new NotFoundException('Account not found');
      }
      if (request.amount !== undefined) {
        const amount = Number(request.amount);
        const links = await this.links(client, 'l.transaction_id = $1', [id]);
        const linked = links.reduce((sum, l) => sum + l.amount, 0);
        if (links.length && Math.sign(amount) !== Math.sign(movement.amount))
          throw new ConflictException(
            'This movement is linked to an item: undo the link to change its direction.',
          );
        if (Math.abs(amount) + 0.005 < linked)
          throw new ConflictException(
            `${euroText(linked)} of this movement is linked to other items: undo a link to bring it below that.`,
          );
      }
      const values: Record<string, unknown> = { ...request };
      if (
        request.description !== undefined &&
        request.amount !== undefined &&
        !request.category
      )
        values['category'] = guessMoneyCategory(
          request.description,
          Number(request.amount),
        );
      const columns: Record<string, string> = {
        accountId: 'account_id',
        date: 'date',
        amount: 'amount',
        description: 'description',
        category: 'category',
        notes: 'notes',
      };
      const set = Object.entries(values).filter(([k]) => k in columns);
      if (!set.length) return;
      await client.query(
        `update money.transactions set ${set
          .map(([k], i) => `${columns[k]} = $${i + 2}`)
          .join(', ')} where id = $1`,
        [id, ...set.map(([, v]) => v ?? null)],
      );
    });
    this.attentionCache = null;
  }

  /** The movements' links, for the movement list (a chip on each). */
  async allLinks(): Promise<LinkRow[]> {
    return this.links(this.svc.pool, null, []);
  }

  private async movement(
    db: pg.Pool | pg.PoolClient,
    id: string,
    lock = false,
  ): Promise<MovementRow | null> {
    const { rows } = await db.query<MovementRow>(
      `select ${MOVEMENT_COLUMNS} from money.transactions t
         join money.accounts a on a.id = t.account_id
        where t.id = $1 ${lock ? 'for update of t' : ''}`,
      [id],
    );
    return rows[0] ?? null;
  }

  private async links(
    db: pg.Pool | pg.PoolClient,
    where: string | null,
    params: unknown[],
    sql?: string,
  ): Promise<LinkRow[]> {
    const { rows } = await db.query<LinkRow>(
      sql ??
        `select ${LINK_COLUMNS} from money.movement_links l
          ${where ? `where ${where}` : ''}
          order by l.created_at desc`,
      params,
    );
    return rows;
  }

  /** Deletes links and tells each area, in the caller's transaction. */
  private async removeLinks(
    client: pg.PoolClient,
    where: string,
    params: unknown[],
    reason: PaymentUnlinkedV1['reason'],
  ): Promise<
    { id: string; movementId: string; payableKey: string; auto: boolean }[]
  > {
    const { rows } = await client.query<{
      id: string;
      movementId: string;
      payableKey: string;
      module: string;
      auto: boolean;
      unlinkedAt: string;
    }>(
      `delete from money.movement_links as l where ${where}
       returning l.id, l.transaction_id as "movementId", l.payable_key as "payableKey",
         l.module, l.auto,
         to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "unlinkedAt"`,
      params,
    );
    for (const row of rows) {
      const event: PaymentUnlinkedV1 = {
        linkId: row.id,
        payableKey: row.payableKey,
        module: row.module,
        reason,
        unlinkedAt: row.unlinkedAt,
      };
      await enqueueEvent(client, this.svc.schema, {
        type: PAYMENT_UNLINKED_EVENT,
        payload: event,
      });
    }
    return rows;
  }
}

/** Whether the area still agrees with a link (MovementLinkDto.status). */
export function linkStatus(
  link: LinkRow,
  links: readonly MatchLink[],
  read: PayablesRead,
): MovementLinkDto['status'] {
  if (!read.sources.some((s) => s.module === link.module && s.ok))
    return 'unknown';
  const payable = read.payables.find((p) => p.key === link.payableKey);
  if (!payable) return 'gone';
  const left = remaining(
    payable.amount * (1 + (payable.tolerance ?? 0)),
    links,
    (l) => l.payableKey === link.payableKey,
  );
  return left < -0.005 ? 'changed' : 'ok';
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
