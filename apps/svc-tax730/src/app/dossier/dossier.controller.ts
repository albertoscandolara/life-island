import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  addAttachmentRequestSchema,
  exportQuerySchema,
  listTax730DocumentsQuerySchema,
  setExpensePairingRequestSchema,
  updateExpenseRequestSchema,
  type DossierExpenseDto,
  type ExpenseDto,
  type Tax730DocumentCandidateDto,
  type TaxYearDossierDto,
  type TaxYearDto,
} from '@life-island/contracts';
import { ExportsService } from '../exports/exports.service.js';
import { IngestionFiles } from '../exports/ingestion-files.js';
import { DossierService } from './dossier.service.js';

/** `attachment; filename=…` with a UTF-8 name and an ASCII fallback. */
function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@Controller()
export class DossierController {
  constructor(
    @Inject(DossierService) private readonly dossier: DossierService,
    @Inject(ExportsService) private readonly exports: ExportsService,
    @Inject(IngestionFiles) private readonly files: IngestionFiles,
  ) {}

  /** Totals per tax year, by expense type, with what is still missing. */
  @Get('tax-years')
  taxYears(): Promise<TaxYearDto[]> {
    return this.dossier.taxYears();
  }

  /** Every document that goes into one year's 730. */
  @Get('tax-years/:year')
  year(@Param('year', ParseIntPipe) year: number): Promise<TaxYearDossierDto> {
    return this.dossier.dossier(year);
  }

  @Post('tax-years/:year/attachments')
  addYearAttachment(
    @Param('year', ParseIntPipe) year: number,
    @Body() body: unknown,
  ): Promise<TaxYearDossierDto> {
    return this.dossier.addYearAttachment(
      year,
      parseOrThrow(addAttachmentRequestSchema, body),
    );
  }

  @Delete('tax-years/:year/attachments/:uploadId')
  removeYearAttachment(
    @Param('year', ParseIntPipe) year: number,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
  ): Promise<TaxYearDossierDto> {
    return this.dossier.removeYearAttachment(year, uploadId);
  }

  /** The zipped folder for the commercialista. */
  @Get('tax-years/:year/export.zip')
  async zip(
    @Param('year', ParseIntPipe) year: number,
  ): Promise<StreamableFile> {
    const zip = await this.exports.zip(year);
    return new StreamableFile(zip.body, {
      type: 'application/zip',
      disposition: attachment(zip.filename),
    });
  }

  /** "Riepilogo detrazioni": one sheet per year (`?year=2025&year=2026`, default every year). */
  @Get('exports/deductions.xlsx')
  async workbook(@Query() query: unknown): Promise<StreamableFile> {
    const { year } = parseOrThrow(exportQuerySchema, query);
    const workbook = await this.exports.workbook(year);
    return new StreamableFile(workbook.body, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: attachment(workbook.filename),
    });
  }

  @Patch('expenses/:id')
  updateExpense(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<ExpenseDto> {
    return this.dossier.updateExpense(
      id,
      parseOrThrow(updateExpenseRequestSchema, body),
    );
  }

  /** File an invoice or a payment proof with an expense. */
  @Post('expenses/:id/attachments')
  addExpenseAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<DossierExpenseDto> {
    return this.dossier.addExpenseAttachment(
      id,
      parseOrThrow(addAttachmentRequestSchema, body),
    );
  }

  @Delete('expenses/:id/attachments/:uploadId')
  removeExpenseAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
  ): Promise<DossierExpenseDto> {
    return this.dossier.removeExpenseAttachment(id, uploadId);
  }

  /** Remove an expense from the 730; its documents stay, free to file elsewhere. */
  @Delete('expenses/:id')
  removeExpense(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaxYearDossierDto> {
    return this.dossier.removeExpense(id);
  }

  /** Pair an expense with another one (`{ pairedWith }`), or keep it apart (`{ pairedWith: null }`). */
  @Put('expenses/:id/pairing')
  setPairing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<TaxYearDossierDto> {
    return this.dossier.setPairing(
      id,
      parseOrThrow(setExpensePairingRequestSchema, body),
    );
  }

  /** Forget your decision: the expense is paired automatically again. */
  @Delete('expenses/:id/pairing')
  resetPairing(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaxYearDossierDto> {
    return this.dossier.resetPairing(id);
  }

  /** Confirm the payments paired automatically with this expense. */
  @Post('expenses/:id/pairing/confirm')
  confirmPairing(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaxYearDossierDto> {
    return this.dossier.confirmPairing(id);
  }

  /** Your documents, to file with an expense or a year; `forExpense` ranks likely payment proofs first. */
  @Get('documents')
  documents(@Query() query: unknown): Promise<Tax730DocumentCandidateDto[]> {
    return this.dossier.documents(
      parseOrThrow(listTax730DocumentsQuerySchema, query),
    );
  }

  /** Shows a document's original file, streamed from svc-ingestion. */
  @Get('documents/:uploadId/preview')
  async preview(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
  ): Promise<StreamableFile> {
    const file = await this.files.open(uploadId, 'preview');
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: 'inline',
      length: file.contentLength ?? undefined,
    });
  }
}
