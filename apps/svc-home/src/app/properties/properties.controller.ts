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
  createPropertyRequestSchema,
  updatePropertyRequestSchema,
  type PropertyDto,
} from '@life-island/contracts';
import { PropertiesService } from './properties.service.js';

@Controller('properties')
export class PropertiesController {
  constructor(
    @Inject(PropertiesService) private readonly properties: PropertiesService,
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
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.properties.remove(id);
  }
}
