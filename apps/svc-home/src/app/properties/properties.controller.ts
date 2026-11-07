import {
  BadRequestException,
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
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import { parseOrThrow } from '@life-island/be-nest';
import {
  createPropertyRequestSchema,
  updatePropertyRequestSchema,
  type PropertyDto,
} from '@life-island/contracts';
import { HouseModels } from './house-models.js';
import { PropertiesService } from './properties.service.js';

@Controller('properties')
export class PropertiesController {
  constructor(
    @Inject(PropertiesService) private readonly properties: PropertiesService,
    @Inject(HouseModels) private readonly models: HouseModels,
  ) {}

  @Get()
  list(): Promise<PropertyDto[]> {
    return this.properties.list();
  }

  @Post()
  create(@Body() body: unknown): Promise<PropertyDto> {
    return this.properties.create(
      parseOrThrow(createPropertyRequestSchema, body),
    );
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<PropertyDto> {
    return this.properties.update(
      id,
      parseOrThrow(updatePropertyRequestSchema, body),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const house = await this.properties.get(id);
    await this.properties.remove(id);
    if (house.modelKey) await this.models.forget(house.modelKey);
  }

  /**
   * Uploads the house's 3D model: the file itself is the request body
   * (application/octet-stream), its name in `?filename=`. It replaces the
   * model the house had.
   */
  @Put(':id/model')
  uploadModel(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('filename') filename: unknown,
    @Req() request: Readable,
  ): Promise<PropertyDto> {
    if (typeof filename !== 'string' || !filename.trim())
      throw new BadRequestException('Name the file with ?filename=');
    return this.models.upload(id, filename.trim().slice(0, 200), request);
  }

  @Get(':id/model')
  async model(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const file = await this.models.open(id);
    return new StreamableFile(file.body, {
      type: file.contentType,
      length: file.size,
    });
  }

  @Delete(':id/model')
  removeModel(@Param('id', ParseUUIDPipe) id: string): Promise<PropertyDto> {
    return this.models.remove(id);
  }
}
