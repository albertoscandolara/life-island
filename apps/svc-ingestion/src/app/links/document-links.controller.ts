import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  createDocumentLinkRequestSchema,
  listDocumentLinksQuerySchema,
  type DocumentLinkDto,
  type DocumentLinksDto,
  type LinkCandidateDto,
} from '@life-island/contracts';
import { DocumentLinksService } from './document-links.service.js';

/**
 * Invoices and their payments. The parse worker reads every document's money
 * facts and links them; here you see the links and decide on them.
 */
@Controller()
export class DocumentLinksController {
  constructor(
    @Inject(DocumentLinksService) private readonly links: DocumentLinksService,
  ) {}

  /** A document's money facts and the invoices or payments linked to it. */
  @Get('uploads/:id/links')
  forUpload(@Param('id', ParseUUIDPipe) id: string): Promise<DocumentLinksDto> {
    return this.links.forUpload(id);
  }

  /** Documents of the other side you could link it to, best match first. */
  @Get('uploads/:id/link-candidates')
  candidates(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LinkCandidateDto[]> {
    return this.links.candidates(id);
  }

  /** Links by status; `?status=SUGGESTED` lists the matches waiting for your check. */
  @Get('document-links')
  list(@Query() query: unknown): Promise<DocumentLinkDto[]> {
    return this.links.list(parseOrThrow(listDocumentLinksQuerySchema, query));
  }

  /** Link an invoice or quote and a payment yourself. */
  @Post('document-links')
  create(@Body() body: unknown): Promise<DocumentLinkDto> {
    return this.links.create(
      parseOrThrow(createDocumentLinkRequestSchema, body),
    );
  }

  @Post('document-links/:id/confirm')
  @HttpCode(200)
  confirm(@Param('id', ParseUUIDPipe) id: string): Promise<DocumentLinkDto> {
    return this.links.confirm(id);
  }

  /** Unlink: they do not belong together, and the matcher never proposes it again. */
  @Post('document-links/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string): Promise<DocumentLinkDto> {
    return this.links.reject(id);
  }

  /** Forget your decision on the pair; the matcher decides about it again. */
  @Delete('document-links/:id')
  @HttpCode(204)
  reset(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.links.reset(id);
  }
}
