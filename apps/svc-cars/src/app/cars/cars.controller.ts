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
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  approveCarReviewRequestSchema,
  createVehicleRequestSchema,
  markCarDocumentRequestSchema,
  updateVehicleRequestSchema,
  type CarsOverviewDto,
} from '@life-island/contracts';
import { CarsService } from './cars.service.js';

@Controller()
export class CarsController {
  constructor(@Inject(CarsService) private readonly cars: CarsService) {}

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
  removeVehicle(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.cars.removeVehicle(id);
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
}
