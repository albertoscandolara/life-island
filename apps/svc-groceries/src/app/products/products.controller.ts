import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import { groceryItemRequestSchema } from '@life-island/contracts';
import type { Readable } from 'node:stream';
import { ProductsService } from './products.service.js';

/** The items of "What you buy": change, remove, and their photo. */
@Controller('items')
export class ProductsController {
  constructor(
    @Inject(ProductsService) private readonly products: ProductsService,
  ) {}

  /** Its name (on every receipt line), aisle and link; answers the id it ends up with. */
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ id: string }> {
    return this.products.update(
      id,
      parseOrThrow(groceryItemRequestSchema, body ?? {}),
    );
  }

  /** Removes it from What you buy; its receipt lines stay in your spending. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.products.hide(id);
  }

  /** Its photo, the file itself as the body (application/octet-stream). */
  @Put(':id/image')
  @HttpCode(204)
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Readable,
  ): Promise<void> {
    return this.products.upload(id, request);
  }

  @Get(':id/image')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  async image(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const file = await this.products.open(id);
    return new StreamableFile(file.body, {
      type: file.contentType,
      length: file.size,
    });
  }

  @Delete(':id/image')
  @HttpCode(204)
  removeImage(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.products.removeImage(id);
  }
}
