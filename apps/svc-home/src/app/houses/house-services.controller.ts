import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  updateHouseServiceDocumentRequestSchema,
  type HouseServicesDto,
} from '@life-island/contracts';
import { HouseServicesService } from './house-services.service.js';

/** The internet lines and insurances of your houses, read from your documents. */
@Controller('house-services')
export class HouseServicesController {
  constructor(
    @Inject(HouseServicesService)
    private readonly services: HouseServicesService,
  ) {}

  @Get()
  list(): Promise<HouseServicesDto> {
    return this.services.list();
  }

  /** Which house an internet or insurance document is about, or that it is about none. */
  @Patch('documents/:uploadId')
  update(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() body: unknown,
  ): Promise<HouseServicesDto> {
    return this.services.update(
      uploadId,
      parseOrThrow(updateHouseServiceDocumentRequestSchema, body),
    );
  }
}
