import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  StreamableFile,
} from '@nestjs/common';
import { attachmentDisposition } from '@life-island/be-common';
import { CarExportsService } from './car-exports.service.js';

const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A car's downloads: what to carry, the summary of its documents, the archive. */
@Controller('vehicles/:id/exports')
export class CarExportsController {
  constructor(
    @Inject(CarExportsService) private readonly exports: CarExportsService,
  ) {}

  /** The files to keep in the car, as they are, zipped: print only what changed. */
  @Get('in-car.zip')
  async inCar(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const file = await this.exports.inCar(id);
    return new StreamableFile(file.body, {
      type: 'application/zip',
      disposition: attachmentDisposition(file.filename),
    });
  }

  /** "Riepilogo documenti": every document, in the car or not, kept until when and why. */
  @Get('documents.xlsx')
  async workbook(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const file = await this.exports.workbook(id);
    return new StreamableFile(file.body, {
      type: XLSX,
      disposition: attachmentDisposition(file.filename),
    });
  }

  /** The documents worth keeping, one folder per kind, with the summary. */
  @Get('archive.zip')
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const file = await this.exports.archive(id);
    return new StreamableFile(file.body, {
      type: 'application/zip',
      disposition: attachmentDisposition(file.filename),
    });
  }
}
