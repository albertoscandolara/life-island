import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TaxYearDossierDto } from '@life-island/contracts';
import JSZip from 'jszip';
import type { Readable } from 'node:stream';
import { DossierService } from '../dossier/dossier.service.js';
import { buildDeductionsWorkbook } from './deductions-workbook.js';
import { dossierFiles, dossierRoot } from './dossier-files.js';
import { IngestionFiles } from './ingestion-files.js';

const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    @Inject(DossierService) private readonly dossier: DossierService,
    @Inject(IngestionFiles) private readonly files: IngestionFiles,
  ) {}

  /** "Riepilogo detrazioni" for the given years (every year when empty). */
  async workbook(years: number[]): Promise<{ filename: string; body: Buffer }> {
    const dossiers = await this.dossier.dossiers(years);
    const span = dossiers.map((d) => d.taxYear).sort();
    const label =
      span.length > 1 ? `${span[0]}-${span[span.length - 1]}` : (span[0] ?? '');
    return {
      filename: `Riepilogo detrazioni ${label}`.trim() + '.xlsx',
      body: await this.workbookBuffer(dossiers),
    };
  }

  /**
   * The folder for the commercialista, zipped: one folder per expense with its
   * invoice and payment proof, the year's documents, the summary workbook,
   * and a note listing anything missing.
   */
  async zip(taxYear: number): Promise<{ filename: string; body: Readable }> {
    const dossier = await this.dossier.dossier(taxYear);
    const root = dossierRoot(dossier);
    const { files, missing } = dossierFiles(dossier, root);
    const zip = new JSZip();
    zip.file(
      `${root}/Riepilogo detrazioni ${taxYear}.xlsx`,
      await this.workbookBuffer([dossier]),
    );
    // A few at a time: the files come one by one from svc-ingestion.
    const queue = [...files];
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        try {
          zip.file(file.path, await this.files.read(file.uploadId));
        } catch (error) {
          this.logger.warn(`Skipped ${file.path}: ${String(error)}`);
          missing.push(`${file.path}: file non disponibile`);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (missing.length)
      zip.file(
        `${root}/DOCUMENTI MANCANTI.txt`,
        `Documenti da completare per il 730/${dossier.filingYear} (redditi ${taxYear}):\r\n\r\n` +
          missing.map((line) => `- ${line}`).join('\r\n') +
          '\r\n',
      );
    return {
      filename: `${today()} - Documentazione 730 ${dossier.filingYear} per commercialista.zip`,
      body: zip.generateNodeStream({
        type: 'nodebuffer',
        streamFiles: true,
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      }) as Readable,
    };
  }

  private async workbookBuffer(dossiers: TaxYearDossierDto[]): Promise<Buffer> {
    const workbook = buildDeductionsWorkbook(dossiers);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
