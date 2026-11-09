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
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import { parseOrThrow } from '@life-island/be-nest';
import {
  approveCarReviewRequestSchema,
  createVehicleRequestSchema,
  groupCarDocumentRequestSchema,
  markCarDocumentRequestSchema,
  updateVehicleRequestSchema,
  type CarsOverviewDto,
} from '@life-island/contracts';
import { CarModels } from './car-models.js';
import { CarsService } from './cars.service.js';

@Controller()
export class CarsController {
  constructor(
    @Inject(CarsService) private readonly cars: CarsService,
    @Inject(CarModels) private readonly models: CarModels,
  ) {}

  /** Every car with its documents, renewals and costs, what waits for review, and warnings. */
  @Get('overview')
  overview(): Promise<CarsOverviewDto> {
    return this.cars.overview();
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
