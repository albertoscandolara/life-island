import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { safeFileName } from '@life-island/be-common';
import {
  IngestionFiles,
  unavailableFilesNote,
  zipFromIngestion,
} from '@life-island/be-nest';
import type { Readable } from 'node:stream';
import { WorkService } from '../work/work.service.js';
import {
  documentFileName,
  findDocument,
  payslipYearFiles,
  workplaceFileName,
} from './payslip-files.js';

export interface Download {
  filename: string;
  contentType: string;
  contentLength: number | null;
  body: Readable;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Work's downloads: one document's original file under a readable name, and
 * a year of payslips with its Certificazione Unica, zipped. The files come
 * from svc-ingestion as they were loaded.
 */
@Injectable()
export class WorkExportsService {
  constructor(
    @Inject(WorkService) private readonly work: WorkService,
    @Inject(IngestionFiles) private readonly files: IngestionFiles,
  ) {}

  async document(uploadId: string): Promise<Download> {
    const { overview, filenames } = await this.work.exportData(todayIso());
    const found = findDocument(overview, uploadId);
    if (!found) throw new NotFoundException('Work document not found');
    const cu = overview.certificates.find((c) => c.uploadId === uploadId);
    const file = await this.files.open(uploadId, 'download');
    return {
      filename: documentFileName(
        found.document,
        workplaceFileName(found.workplace),
        filenames.get(uploadId) ?? '',
        cu?.year ?? null,
      ),
      contentType: file.contentType,
      contentLength: file.contentLength,
      body: file.body,
    };
  }

  /** Every payslip paid in the year, and the year's CU, in one folder. */
  async payslipYear(
    year: number,
  ): Promise<{ filename: string; body: Readable }> {
    const today = todayIso();
    const { overview, filenames } = await this.work.exportData(today);
    const root = safeFileName(`Cedolini ${year}`);
    const files = payslipYearFiles(overview, year, filenames, root);
    if (!files.length)
      throw new NotFoundException(`No payslips of ${year} on record`);
    return {
      filename: `${today} - ${root}.zip`,
      body: await zipFromIngestion(this.files, {
        files,
        missingNote: unavailableFilesNote(root),
      }),
    };
  }
}
