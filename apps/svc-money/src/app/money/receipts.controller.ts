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
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  RECEIPT_MAX_BYTES,
  RECEIPT_MAX_FILES,
  type MovementAttachmentDto,
  type ReceiptReadingDto,
} from '@life-island/contracts';
import {
  ReceiptsService,
  toAiFiles,
  type UploadedReceipt,
} from './receipts.js';

/** One file more than allowed reaches the check, which says so in words. */
const receiptFiles = () =>
  FilesInterceptor('files', RECEIPT_MAX_FILES + 1, {
    limits: { fileSize: RECEIPT_MAX_BYTES + 1 },
  });

/**
 * Receipts, order screenshots and photos filed with a movement, and the
 * receipt reader (money.receipt-reader).
 */
@Controller()
export class ReceiptsController {
  constructor(
    @Inject(ReceiptsService) private readonly receipts: ReceiptsService,
  ) {}

  /** Files receipts with a movement (multipart: `files`, up to 6). */
  @Post('transactions/:id/attachments')
  @UseInterceptors(receiptFiles())
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() uploaded: UploadedReceipt[] | undefined,
  ): Promise<MovementAttachmentDto[]> {
    return this.receipts.attach(id, toAiFiles(uploaded ?? []));
  }

  /** Forgets a receipt of a movement; the document stays in the documents app. */
  @Delete('transactions/:id/attachments/:attachmentId')
  @HttpCode(204)
  detach(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<void> {
    return this.receipts.detach(id, attachmentId);
  }

  /** Shows a receipt, streamed from svc-ingestion. */
  @Get('attachments/:id/preview')
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const file = await this.receipts.preview(id);
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: 'inline',
      length: file.contentLength ?? undefined,
    });
  }

  /** Reads the receipts of a movement, to check before applying. */
  @Post('transactions/:id/read')
  @HttpCode(200)
  readMovement(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReceiptReadingDto> {
    return this.receipts.readMovement(id);
  }

  /**
   * Reads receipts not filed yet (multipart: `files` and an optional
   * `note`), for a new expense: nothing is stored.
   */
  @Post('receipts/read')
  @HttpCode(200)
  @UseInterceptors(receiptFiles())
  read(
    @UploadedFiles() uploaded: UploadedReceipt[] | undefined,
    @Body() body: { note?: unknown } | undefined,
  ): Promise<ReceiptReadingDto> {
    const note =
      typeof body?.note === 'string' && body.note.trim()
        ? body.note.trim().slice(0, 500)
        : null;
    return this.receipts.read(toAiFiles(uploaded ?? []), note);
  }
}
