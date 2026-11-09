import type { TransactionFacts } from '@life-island/contracts';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import {
  proposeLinks,
  type LinkDecision,
  type MatchDocument,
  type ProposedLink,
} from './document-matching.js';
import { documentLinks, uploads } from './schema.js';

/** Serializes relinking between the worker and the API. */
const RELINK_LOCK = `select pg_advisory_xact_lock(hashtext('ingestion.document_links'))`;

export interface RelinkSummary {
  created: number;
  updated: number;
  removed: number;
}

const MATCHED_ROLES = ['INVOICE', 'QUOTE', 'PAYMENT'];

/**
 * Brings `document_links` in line with what the matcher finds across every
 * document whose money facts are known: new links are added, links that no
 * longer hold are removed, and an AUTO link becomes SUGGESTED when a new
 * document makes it ambiguous (or the other way round). Your CONFIRMED and
 * REJECTED links are never touched. Runs in the caller's transaction, under
 * a lock, so two relinks never interleave.
 */
export async function relinkDocuments(
  client: pg.PoolClient,
): Promise<RelinkSummary> {
  await client.query(RELINK_LOCK);
  const db = drizzle(client);
  const rows = await db
    .select({ uploadId: uploads.id, facts: uploads.transactionFacts })
    .from(uploads)
    .where(isNotNull(uploads.transactionFacts));
  const documents: MatchDocument[] = rows
    .filter((row): row is { uploadId: string; facts: TransactionFacts } =>
      MATCHED_ROLES.includes(row.facts?.role ?? ''),
    )
    .map((row) => ({ uploadId: row.uploadId, facts: row.facts }));
  const existing = await db.select().from(documentLinks);
  const decisions: LinkDecision[] = existing
    .filter((link) => link.status === 'CONFIRMED' || link.status === 'REJECTED')
    .map((link) => ({
      invoiceUploadId: link.invoiceUploadId,
      paymentUploadId: link.paymentUploadId,
      status: link.status as LinkDecision['status'],
    }));
  const proposed = proposeLinks(documents, decisions);

  const key = (link: { invoiceUploadId: string; paymentUploadId: string }) =>
    `${link.invoiceUploadId}|${link.paymentUploadId}`;
  const current = new Map(existing.map((link) => [key(link), link]));
  const wanted = new Map<string, ProposedLink>();
  for (const link of proposed) {
    const manual = current.get(key(link));
    if (
      manual &&
      (manual.status === 'CONFIRMED' || manual.status === 'REJECTED')
    )
      continue;
    wanted.set(key(link), link);
  }

  const summary: RelinkSummary = { created: 0, updated: 0, removed: 0 };
  const now = new Date();
  const stale = existing.filter(
    (link) =>
      (link.status === 'AUTO' || link.status === 'SUGGESTED') &&
      !wanted.has(key(link)),
  );
  if (stale.length) {
    await db.delete(documentLinks).where(
      inArray(
        documentLinks.id,
        stale.map((link) => link.id),
      ),
    );
    summary.removed = stale.length;
  }
  for (const link of wanted.values()) {
    const row = current.get(key(link));
    if (!row) {
      await db.insert(documentLinks).values({ ...link, updatedAt: now });
      summary.created++;
    } else if (
      row.status !== link.status ||
      Number(row.score) !== link.score ||
      JSON.stringify(row.reasons) !== JSON.stringify(link.reasons)
    ) {
      await db
        .update(documentLinks)
        .set({
          status: link.status,
          score: link.score,
          reasons: link.reasons,
          updatedAt: now,
        })
        .where(eq(documentLinks.id, row.id));
      summary.updated++;
    }
  }
  return summary;
}

/**
 * A document is read again: what the AI read about its money is cleared, and
 * so are the matcher's links to it. Your own decisions stay.
 */
export async function forgetTransactionFacts(
  client: pg.PoolClient,
  uploadIds: string[],
): Promise<void> {
  if (!uploadIds.length) return;
  const db = drizzle(client);
  await db
    .update(uploads)
    .set({ transactionFacts: null })
    .where(inArray(uploads.id, uploadIds));
  await db
    .delete(documentLinks)
    .where(
      and(
        inArray(documentLinks.status, ['AUTO', 'SUGGESTED']),
        or(
          inArray(documentLinks.invoiceUploadId, uploadIds),
          inArray(documentLinks.paymentUploadId, uploadIds),
        ),
      ),
    );
}
