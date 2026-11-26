import {
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  StreamableFile,
} from '@nestjs/common';
import { attachmentDisposition } from '@life-island/be-common';
import { WorkExportsService } from './work-exports.service.js';

/** Work's downloads: one document, or a year of payslips. */
@Controller()
export class WorkExportsController {
  constructor(
    @Inject(WorkExportsService) private readonly exports: WorkExportsService,
  ) {}

  /** A work document's original file, saved under a readable name. */
  @Get('documents/:uploadId/download')
  async document(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
  ): Promise<StreamableFile> {
    const file = await this.exports.document(uploadId);
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: attachmentDisposition(file.filename),
      length: file.contentLength ?? undefined,
    });
  }

  /** The payslips paid in a year and its Certificazione Unica, zipped. */
  @Get('payslips/:year/archive.zip')
  async payslipYear(
    @Param('year', ParseIntPipe) year: number,
  ): Promise<StreamableFile> {
    const file = await this.exports.payslipYear(year);
    return new StreamableFile(file.body, {
      type: 'application/zip',
      disposition: attachmentDisposition(file.filename),
    });
  }
}
