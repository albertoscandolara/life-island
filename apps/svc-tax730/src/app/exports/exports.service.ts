import { Inject, Injectable } from '@nestjs/common';
import type { TaxYearDossierDto } from '@life-island/contracts';
import type { Readable } from 'node:stream';
import { DossierService } from '../dossier/dossier.service.js';
import { buildDeductionsWorkbook } from './deductions-workbook.js';
import { dossierFiles, dossierRoot } from './dossier-files.js';
import { IngestionFiles, zipFromIngestion } from '@life-island/be-nest';

const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class ExportsService {
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
    const body = await zipFromIngestion(this.files, {
      files,
      extra: [
        {
          path: `${root}/Riepilogo detrazioni ${taxYear}.xlsx`,
          body: await this.workbookBuffer([dossier]),
        },
      ],
      missingNote: (unread) => {
        const lines = [
          ...missing,
          ...unread.map((path) => `${path}: file non disponibile`),
        ];
        return lines.length
          ? {
              path: `${root}/DOCUMENTI MANCANTI.txt`,
              text:
                `Documenti da completare per il 730/${dossier.filingYear} (redditi ${taxYear}):\r\n\r\n` +
                lines.map((line) => `- ${line}`).join('\r\n') +
                '\r\n',
            }
          : null;
      },
    });
    return {
      filename: `${today()} - Documentazione 730 ${dossier.filingYear} per commercialista.zip`,
      body,
    };
  }

  private async workbookBuffer(dossiers: TaxYearDossierDto[]): Promise<Buffer> {
    const workbook = buildDeductionsWorkbook(dossiers);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
