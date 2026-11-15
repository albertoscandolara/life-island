import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  StreamableFile,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { ServiceDb } from '@life-island/be-common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  mergeOrganizationRequestSchema,
  ORGANIZATION_IMAGE_KINDS,
  type OrganizationDetailDto,
  type OrganizationImageKind,
  type OrganizationStatus,
} from '@life-island/contracts';
import { eq, inArray } from 'drizzle-orm';
import { SERVICE_DB } from '../config.js';
import { organizations, supplyContracts } from '../db/schema.js';
import { OrganizationImages } from './organization-images.js';
import { mergeOrganizations } from './organization-merge.js';
import { organizationDetail } from './organizations.js';

/**
 * Companies as entities: every company a document names is suggested, and
 * you confirm it (it then links everywhere), merge it into the company it
 * really is, or dismiss it (a misread name, never suggested again).
 */
@Controller('organizations')
export class OrganizationsController {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(OrganizationImages) private readonly images: OrganizationImages,
  ) {}

  /** A company's page: its data, the documents it issued and its houses. */
  @Get(':id')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrganizationDetailDto> {
    const found = await organizationDetail(this.svc.db, id);
    if (!found) throw new NotFoundException(`Organization ${id} not found`);
    return found;
  }

  /**
   * Deletes a company that nothing points to: no document names it, and it
   * has no bills, contracts or houses. One that has them is merged into the
   * company it really is instead, so nothing loses its company.
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const found = await organizationDetail(this.svc.db, id);
    if (!found) throw new NotFoundException(`Organization ${id} not found`);
    const contracts = await this.svc.db
      .select({ id: supplyContracts.id })
      .from(supplyContracts)
      .where(eq(supplyContracts.supplierId, id));
    if (
      found.documentCount ||
      found.billCount ||
      found.houses.length ||
      contracts.length
    )
      throw new ConflictException(
        'This company has documents, bills or houses: merge it into the company it really is instead',
      );
    const [row] = await this.svc.db
      .delete(organizations)
      .where(eq(organizations.id, id))
      .returning();
    for (const key of [row?.logoKey, row?.coverKey])
      if (key) await this.images.forget(key);
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
    const orphans = await this.svc.db.transaction((tx) =>
      mergeOrganizations(tx, id, from),
    );
    for (const key of orphans) await this.images.forget(key);
    return this.detail(id);
  }

  /**
   * Uploads the company's logo or background image (`kind`: logo or cover):
   * the file itself is the request body (application/octet-stream). It
   * replaces the image it had.
   */
  @Put(':id/images/:kind')
  async uploadImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
    @Req() request: Readable,
  ): Promise<OrganizationDetailDto> {
    await this.images.upload(id, imageKind(kind), request);
    return this.detail(id);
  }

  @Get(':id/images/:kind')
  @Header('X-Content-Type-Options', 'nosniff')
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
  ): Promise<StreamableFile> {
    const file = await this.images.open(id, imageKind(kind));
    return new StreamableFile(file.body, {
      type: file.contentType,
      length: file.size,
    });
  }

  @Delete(':id/images/:kind')
  async removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
  ): Promise<OrganizationDetailDto> {
    await this.images.remove(id, imageKind(kind));
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

function imageKind(kind: string): OrganizationImageKind {
  if (!(ORGANIZATION_IMAGE_KINDS as readonly string[]).includes(kind))
    throw new BadRequestException('The image is a logo or a cover');
  return kind as OrganizationImageKind;
}
