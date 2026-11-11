import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  BadRequestException,
  UploadedFiles,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Readable } from 'node:stream';
import { parseOrThrow } from '@life-island/be-nest';
import {
  approveCarReviewRequestSchema,
  createTyreSetRequestSchema,
  createVehicleRequestSchema,
  QUOTE_MAX_BYTES,
  QUOTE_MAX_FILES,
  updateFineRequestSchema,
  updateTyreSetRequestSchema,
  type QuoteComparisonDto,
  groupCarDocumentRequestSchema,
  markCarDocumentRequestSchema,
  updateVehicleRequestSchema,
  type CarsOverviewDto,
  type CarsPeopleDto,
  deadlinesQuerySchema,
  type DeadlineDto,
} from '@life-island/contracts';
import { CarModels } from './car-models.js';
import { CarPeople } from './car-people.js';
import { CarsService } from './cars.service.js';
import { IngestionFiles } from '../documents/ingestion-files.js';
import { QuoteAdvisor, type QuoteFile } from './quote-advisor.js';

/** A file multer kept in memory. */
interface UploadedQuote {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

@Controller()
export class CarsController {
  private readonly logger = new Logger(CarsController.name);

  constructor(
    @Inject(CarsService) private readonly cars: CarsService,
    @Inject(CarModels) private readonly models: CarModels,
    @Inject(CarPeople) private readonly people: CarPeople,
    @Inject(QuoteAdvisor) private readonly quotes: QuoteAdvisor,
    @Inject(IngestionFiles) private readonly files: IngestionFiles,
  ) {}

  /** Every car with its documents, renewals and costs, what waits for review, and warnings. */
  @Get('overview')
  async overview(): Promise<CarsOverviewDto> {
    return this.cars.overview(undefined, await this.quotes.usesAi());
  }

  /** Every renewal date of the cars in use, for the Agenda. */
  @Get('deadlines')
  deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    return this.cars.deadlines(parseOrThrow(deadlinesQuerySchema, query));
  }

  /** What you add to a fine by hand: when it reached you, when you paid, who drove. */
  @Put('fines/:uploadId')
  @HttpCode(204)
  updateFine(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.cars.updateFine(
      uploadId,
      parseOrThrow(updateFineRequestSchema, body),
    );
  }

  @Post('vehicles/:id/tyres')
  createTyreSet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ id: string }> {
    return this.cars.createTyreSet(
      id,
      parseOrThrow(createTyreSetRequestSchema, body),
    );
  }

  @Patch('tyres/:id')
  @HttpCode(204)
  updateTyreSet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.cars.updateTyreSet(
      id,
      parseOrThrow(updateTyreSetRequestSchema, body),
    );
  }

  @Delete('tyres/:id')
  @HttpCode(204)
  removeTyreSet(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.cars.removeTyreSet(id);
  }

  /**
   * Compares insurance quotes (multipart: `quotes`, up to 4 PDFs or photos,
   * and an optional `note`) with the car's current policy, with Claude. The
   * files are read and dropped; only the comparison is kept.
   */
  @Post('vehicles/:id/insurance-quotes')
  @UseInterceptors(
    FilesInterceptor('quotes', QUOTE_MAX_FILES + 1, {
      limits: { fileSize: QUOTE_MAX_BYTES + 1 },
    }),
  )
  async compareQuotes(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() uploaded: UploadedQuote[] | undefined,
    @Body() body: { note?: unknown } | undefined,
  ): Promise<QuoteComparisonDto> {
    const note =
      typeof body?.note === 'string' && body.note.trim()
        ? body.note.trim().slice(0, 1000)
        : null;
    const quotes: QuoteFile[] = (uploaded ?? []).map((f) => ({
      name: f.originalname.slice(0, 200),
      contentType: f.mimetype,
      data: f.buffer,
    }));
    const { dossier, policyUploadIds } = await this.cars.quoteContext(id, note);
    const policy: QuoteFile[] = [];
    for (const uploadId of policyUploadIds) {
      try {
        const file = await this.files.open(uploadId);
        const chunks: Buffer[] = [];
        for await (const chunk of file.body) chunks.push(Buffer.from(chunk));
        const data = Buffer.concat(chunks);
        if (data.length <= QUOTE_MAX_BYTES)
          policy.push({
            name: `Current policy ${uploadId}`,
            contentType: file.contentType,
            data,
          });
      } catch (error) {
        this.logger.warn(
          `The current policy ${uploadId} could not be read: ${String(error)}`,
        );
      }
    }
    const { output, model } = await this.quotes.compare(
      dossier,
      policy,
      quotes,
    );
    return this.cars.saveComparison(
      id,
      quotes.map((q) => q.name),
      note,
      output,
      model,
    );
  }

  @Delete('quote-comparisons/:id')
  @HttpCode(204)
  removeComparison(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.cars.removeComparison(id);
  }

  /** The people of the People area, to pick as the holder or owner of a car. */
  @Get('people')
  listPeople(): Promise<CarsPeopleDto> {
    return this.people.list();
  }

  /** A car added by hand, by its plate. */
  @Post('vehicles')
  createVehicle(@Body() body: unknown): Promise<{ id: string }> {
    return this.cars.createVehicle(
      parseOrThrow(createVehicleRequestSchema, body),
    );
  }

  @Patch('vehicles/:id')
  @HttpCode(204)
  updateVehicle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.cars.updateVehicle(
      id,
      parseOrThrow(updateVehicleRequestSchema, body),
    );
  }

  /** Removes the car; its documents go back to review. */
  @Delete('vehicles/:id')
  @HttpCode(204)
  async removeVehicle(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const modelKey = await this.cars.removeVehicle(id);
    if (modelKey) await this.models.forget(modelKey);
  }

  /**
   * Uploads the car's 3D model: the file itself is the request body
   * (application/octet-stream), its name in `?filename=`. It replaces the
   * model the car had.
   */
  @Put('vehicles/:id/model')
  @HttpCode(204)
  async uploadModel(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('filename') filename: unknown,
    @Req() request: Readable,
  ): Promise<void> {
    if (typeof filename !== 'string' || !filename.trim())
      throw new BadRequestException('Name the file with ?filename=');
    await this.models.upload(id, filename.trim().slice(0, 200), request);
  }

  @Get('vehicles/:id/model')
  async model(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const file = await this.models.open(id);
    return new StreamableFile(file.body, {
      type: file.contentType,
      length: file.size,
    });
  }

  @Delete('vehicles/:id/model')
  @HttpCode(204)
  async removeModel(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.models.remove(id);
  }

  @Post('reviews/:uploadId/approve')
  @HttpCode(204)
  async approve(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.cars.approve(
      uploadId,
      parseOrThrow(approveCarReviewRequestSchema, body),
    );
  }

  @Post('reviews/:uploadId/reject')
  @HttpCode(204)
  reject(@Param('uploadId', ParseUUIDPipe) uploadId: string): Promise<void> {
    return this.cars.reject(uploadId);
  }

  @Post('reviews/:uploadId/reopen')
  @HttpCode(204)
  reopen(@Param('uploadId', ParseUUIDPipe) uploadId: string): Promise<void> {
    return this.cars.reopen(uploadId);
  }

  @Patch('documents/:uploadId')
  @HttpCode(204)
  mark(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.cars.mark(
      uploadId,
      parseOrThrow(markCarDocumentRequestSchema, body),
    );
  }

  /** Attaches the document to the record of another one, or (null) detaches it. */
  @Put('documents/:uploadId/group')
  @HttpCode(204)
  group(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.cars.group(
      uploadId,
      parseOrThrow(groupCarDocumentRequestSchema, body),
    );
  }
}
