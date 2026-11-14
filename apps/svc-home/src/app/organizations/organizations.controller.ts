import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  mergeOrganizationRequestSchema,
  type OrganizationDetailDto,
  type OrganizationStatus,
} from '@life-island/contracts';
import { eq, inArray } from 'drizzle-orm';
import { SERVICE_DB } from '../config.js';
import { organizations } from '../db/schema.js';
import { mergeOrganizations } from './organization-merge.js';
import { organizationDetail } from './organizations.js';

/**
 * Companies as entities: every company a document names is suggested, and
 * you confirm it (it then links everywhere), merge it into the company it
 * really is, or dismiss it (a misread name, never suggested again).
 */
@Controller('organizations')
export class OrganizationsController {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  /** A company's page: its data, the documents it issued and its houses. */
  @Get(':id')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrganizationDetailDto> {
    const found = await organizationDetail(this.svc.db, id);
    if (!found) throw new NotFoundException(`Organization ${id} not found`);
    return found;
  }

  @Post(':id/confirm')
  @HttpCode(204)
  confirm(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.setStatus(id, 'CONFIRMED');
  }

  @Post(':id/dismiss')
  @HttpCode(204)
  dismiss(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.setStatus(id, 'DISMISSED');
  }

  /** Suggests a dismissed company again. */
  @Post(':id/reopen')
  @HttpCode(204)
  reopen(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.setStatus(id, 'PENDING');
  }

  /** Confirms every company waiting for you. */
  @Post('confirm-pending')
  async confirmPending(): Promise<{ confirmed: number }> {
    const rows = await this.svc.db
      .update(organizations)
      .set({ status: 'CONFIRMED' })
      .where(eq(organizations.status, 'PENDING'))
      .returning({ id: organizations.id });
    return { confirmed: rows.length };
  }

  /** Merges a duplicate into this company, which is then confirmed. */
  @Post(':id/merge')
  async merge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<OrganizationDetailDto> {
    const { from } = parseOrThrow(mergeOrganizationRequestSchema, body);
    if (from === id)
      throw new BadRequestException('A company cannot merge into itself');
    const found = await this.svc.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(inArray(organizations.id, [id, from]));
    if (found.length !== 2)
      throw new NotFoundException('Both companies must exist');
    await this.svc.db.transaction((tx) => mergeOrganizations(tx, id, from));
    return this.detail(id);
  }

  private async setStatus(
    id: string,
    status: OrganizationStatus,
  ): Promise<void> {
    const rows = await this.svc.db
      .update(organizations)
      .set({ status })
      .where(eq(organizations.id, id))
      .returning({ id: organizations.id });
    if (!rows.length)
      throw new NotFoundException(`Organization ${id} not found`);
  }
}
