import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { RecordCollections } from '@life-island/be-nest';
import { RECORDS } from './health/collections.js';

/**
 * Adds, changes and removes Health's plain records (collections.ts). Mounted
 * after the Health controller, so its own routes win.
 */
@Controller()
export class RecordsController {
  constructor(@Inject(RECORDS) private readonly records: RecordCollections) {}

  @Post(':collection')
  create(
    @Param('collection') collection: string,
    @Body() body: unknown,
  ): Promise<{ id: string }> {
    return this.records.create(collection, body);
  }

  @Put(':collection/:id')
  @HttpCode(204)
  update(
    @Param('collection') collection: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.records.update(collection, id, body);
  }

  @Delete(':collection/:id')
  @HttpCode(204)
  remove(
    @Param('collection') collection: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.records.remove(collection, id);
  }
}
