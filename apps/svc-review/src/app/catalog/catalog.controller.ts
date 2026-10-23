import { Controller, Get } from '@nestjs/common';
import {
  catalogForApi,
  type TargetCatalogEntryDto,
} from '@life-island/contracts';

/** Where extracted data can go: one entry per versioned target, with its JSON Schema. */
@Controller('catalog')
export class CatalogController {
  private readonly catalog = catalogForApi();

  @Get()
  list(): TargetCatalogEntryDto[] {
    return this.catalog;
  }
}
