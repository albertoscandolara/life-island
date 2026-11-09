import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { withTransaction, type ServiceDb } from '@life-island/be-common';
import type {
  CreateDocumentLinkRequest,
  DocumentLinkDto,
  DocumentLinksDto,
  LinkCandidateDto,
  LinkedDocumentDto,
  listDocumentLinksQuerySchema,
} from '@life-island/contracts';
import {
  documentLinks,
  relinkDocuments,
  scorePair,
  uploads,
  type DocumentLinkRow,
  type UploadRow,
} from '@life-island/ingestion-db';
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';

type DocumentSummaryRow = Pick<
  UploadRow,
  'id' | 'title' | 'originalFilename' | 'transactionFacts'
>;

const summaryColumns = {
  id: uploads.id,
  title: uploads.title,
  originalFilename: uploads.originalFilename,
  transactionFacts: uploads.transactionFacts,
};

function linkedDocument(row: DocumentSummaryRow): LinkedDocumentDto {
  const facts = row.transactionFacts;
  return {
    uploadId: row.id,
    title: row.title,
    originalFilename: row.originalFilename,
    role: facts?.role ?? 'NONE',
    documentKind: facts?.documentKind ?? null,
    documentNumber: facts?.documentNumber ?? null,
    date:
      (facts?.role === 'PAYMENT'
        ? (facts.paymentDate ?? facts.issueDate)
        : facts?.issueDate) ?? null,
    amount: facts?.amount ?? null,
    currency: facts?.currency ?? null,
    counterparty: facts?.counterparty.name ?? null,
  };
}

const STATUS_ORDER = { CONFIRMED: 0, AUTO: 1, SUGGESTED: 2, REJECTED: 3 };

/**
 * Invoices and the payments that settle them: what the matcher linked, what
 * it suggests for you to check, and the links you make, confirm or reject.
 * Every decision of yours is followed by a relink, since it can settle what
 * the matcher found ambiguous.
 */
@Injectable()
export class DocumentLinksService {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  /** A document's money facts and its links (except those you rejected). */
  async forUpload(uploadId: string): Promise<DocumentLinksDto> {
    const [row] = await this.svc.db
      .select(summaryColumns)
      .from(uploads)
      .where(eq(uploads.id, uploadId));
    if (!row) throw new NotFoundException(`Upload ${uploadId} not found`);
    const rows = await this.svc.db
      .select()
      .from(documentLinks)
      .where(
        and(
          or(
            eq(documentLinks.invoiceUploadId, uploadId),
            eq(documentLinks.paymentUploadId, uploadId),
          ),
          ne(documentLinks.status, 'REJECTED'),
        ),
      );
    const links = (await this.toDtos(rows)).sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.score - a.score,
    );
    const settled = links.filter(
      (link) => link.status === 'AUTO' || link.status === 'CONFIRMED',
    );
    const amounts = settled
      .map((link) =>
        link.invoiceUploadId === uploadId
          ? link.payment.amount
          : link.invoice.amount,
      )
      .filter((amount): amount is number => amount !== null);
    return {
      uploadId,
      facts: row.transactionFacts,
      links,
      linkedTotal: amounts.length
        ? Math.round(amounts.reduce((sum, value) => sum + value, 0) * 100) / 100
        : null,
    };
  }

  /**
   * Documents of the other side (payments for an invoice or quote, invoices
   * and quotes for a payment) not linked to it yet, best match first, for
   * linking by hand.
   */
  async candidates(uploadId: string): Promise<LinkCandidateDto[]> {
    const [row] = await this.svc.db
      .select(summaryColumns)
      .from(uploads)
      .where(eq(uploads.id, uploadId));
    if (!row) throw new NotFoundException(`Upload ${uploadId} not found`);
    const facts = row.transactionFacts;
    if (!facts || facts.role === 'NONE') return [];
    const isPayment = facts.role === 'PAYMENT';
    const roles = isPayment ? ['INVOICE', 'QUOTE'] : ['PAYMENT'];
    const linked = await this.svc.db
      .select()
      .from(documentLinks)
      .where(
        and(
          or(
            eq(documentLinks.invoiceUploadId, uploadId),
            eq(documentLinks.paymentUploadId, uploadId),
          ),
          ne(documentLinks.status, 'REJECTED'),
        ),
      );
    const taken = new Set(
      linked.flatMap((link) => [link.invoiceUploadId, link.paymentUploadId]),
    );
    const others = await this.svc.db
      .select(summaryColumns)
      .from(uploads)
      .where(
        sql`${uploads.transactionFacts} ->> 'role' in (${sql.join(
          roles.map((role) => sql`${role}`),
          sql`, `,
        )})`,
      );
    return others
      .filter((other) => other.id !== uploadId && !taken.has(other.id))
      .map((other) => {
        const pair = isPayment
          ? scorePair(other.transactionFacts!, facts)
          : scorePair(facts, other.transactionFacts!);
        return {
          document: linkedDocument(other),
          score: pair.score,
          reasons: pair.reasons,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
  }

  /** Links by status, most recently changed first: `SUGGESTED` lists what waits for your check. */
  async list(
    query: z.output<typeof listDocumentLinksQuerySchema>,
  ): Promise<DocumentLinkDto[]> {
    const rows = await this.svc.db
      .select()
      .from(documentLinks)
      .where(query.status ? eq(documentLinks.status, query.status) : undefined)
      .orderBy(desc(documentLinks.updatedAt), desc(documentLinks.score))
      .limit(query.limit);
    return this.toDtos(rows);
  }

  /** You link an invoice (or quote) and a payment yourself. */
  async create(request: CreateDocumentLinkRequest): Promise<DocumentLinkDto> {
    if (request.invoiceUploadId === request.paymentUploadId)
      throw new BadRequestException('A document cannot pay itself');
    const id = await withTransaction(this.svc.pool, async (client) => {
      const db = drizzle(client);
      const found = await db
        .select({ id: uploads.id })
        .from(uploads)
        .where(
          inArray(uploads.id, [
            request.invoiceUploadId,
            request.paymentUploadId,
          ]),
        );
      if (found.length < 2)
        throw new NotFoundException('Both documents must exist');
      const now = new Date();
      const [saved] = await db
        .insert(documentLinks)
        .values({
          invoiceUploadId: request.invoiceUploadId,
          paymentUploadId: request.paymentUploadId,
          status: 'CONFIRMED',
          reasons: ['Linked by you'],
          decidedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            documentLinks.invoiceUploadId,
            documentLinks.paymentUploadId,
          ],
          set: { status: 'CONFIRMED', decidedAt: now, updatedAt: now },
        })
        .returning({ id: documentLinks.id });
      await relinkDocuments(client);
      return saved.id;
    });
    return this.get(id);
  }

  /** You confirm a link the matcher made or suggested (or undo a rejection). */
  confirm(id: string): Promise<DocumentLinkDto> {
    return this.decide(id, 'CONFIRMED');
  }

  /** You say the two documents do not belong together; never proposed again. */
  reject(id: string): Promise<DocumentLinkDto> {
    return this.decide(id, 'REJECTED');
  }

  /** Forget your decision on a pair: the matcher decides about it again. */
  async reset(id: string): Promise<void> {
    await withTransaction(this.svc.pool, async (client) => {
      const deleted = await drizzle(client)
        .delete(documentLinks)
        .where(eq(documentLinks.id, id))
        .returning({ id: documentLinks.id });
      if (!deleted.length) throw new NotFoundException(`Link ${id} not found`);
      await relinkDocuments(client);
    });
  }

  private async decide(
    id: string,
    status: 'CONFIRMED' | 'REJECTED',
  ): Promise<DocumentLinkDto> {
    await withTransaction(this.svc.pool, async (client: pg.PoolClient) => {
      const now = new Date();
      const updated = await drizzle(client)
        .update(documentLinks)
        .set({ status, decidedAt: now, updatedAt: now })
        .where(eq(documentLinks.id, id))
        .returning({ id: documentLinks.id });
      if (!updated.length) throw new NotFoundException(`Link ${id} not found`);
      await relinkDocuments(client);
    });
    return this.get(id);
  }

  private async get(id: string): Promise<DocumentLinkDto> {
    const rows = await this.svc.db
      .select()
      .from(documentLinks)
      .where(eq(documentLinks.id, id));
    if (!rows.length) throw new NotFoundException(`Link ${id} not found`);
    return (await this.toDtos(rows))[0];
  }

  private async toDtos(rows: DocumentLinkRow[]): Promise<DocumentLinkDto[]> {
    if (!rows.length) return [];
    const ids = [
      ...new Set(
        rows.flatMap((row) => [row.invoiceUploadId, row.paymentUploadId]),
      ),
    ];
    const documents = new Map(
      (
        await this.svc.db
          .select(summaryColumns)
          .from(uploads)
          .where(inArray(uploads.id, ids))
      ).map((row) => [row.id, linkedDocument(row)]),
    );
    return rows.map((row) => ({
      id: row.id,
      invoiceUploadId: row.invoiceUploadId,
      paymentUploadId: row.paymentUploadId,
      status: row.status,
      score: Number(row.score),
      reasons: row.reasons,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      invoice: documents.get(row.invoiceUploadId)!,
      payment: documents.get(row.paymentUploadId)!,
    }));
  }
}
