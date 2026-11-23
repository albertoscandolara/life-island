import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CAR_ARCHIVE_FOLDER_LABELS,
  type CarArchiveItemDto,
  type VehicleDto,
} from '@life-island/contracts';
import {
  fileExtension,
  safeFileName,
  uniquePaths,
} from '@life-island/be-common';
import { IngestionFiles } from '@life-island/be-nest';
import JSZip from 'jszip';
import type { Readable } from 'node:stream';
import { todayIso } from '../cars/car-documents.js';
import { CarsService, vehicleName } from '../cars/cars.service.js';
import { buildCarDocumentsWorkbook } from './car-documents-workbook.js';

export interface Download<T> {
  filename: string;
  body: T;
}

const carNameOf = (vehicle: VehicleDto) =>
  vehicleName({ label: vehicle.label, values: vehicle.values });

/** The archive's path of one file: its folder, then "date - title.ext". */
export function archivePath(
  root: string,
  item: Pick<CarArchiveItemDto, 'folder' | 'date'>,
  title: string,
  filename: string,
): string {
  const name = safeFileName([item.date, title].filter(Boolean).join(' - '));
  return `${root}/${CAR_ARCHIVE_FOLDER_LABELS[item.folder].it}/${name}${fileExtension(filename)}`;
}

/**
 * "Kind - date - title.ext" in one folder: the files to print for the car,
 * named so the folder sorts them by kind.
 */
export function inCarPath(
  root: string,
  item: Pick<CarArchiveItemDto, 'folder' | 'date'>,
  title: string,
  filename: string,
): string {
  const kind = CAR_ARCHIVE_FOLDER_LABELS[item.folder].it.slice(5);
  const name = safeFileName(
    [kind, item.date, title].filter(Boolean).join(' - '),
  );
  return `${root}/${name}${fileExtension(filename)}`;
}

/**
 * A car's downloads: the files to keep in the car (zip, as they are), the summary
 * of every document (Excel) and the archive of what to keep (zip, one
 * folder per kind). The files come from svc-ingestion, a few at a time.
 */
@Injectable()
export class CarExportsService {
  private readonly logger = new Logger(CarExportsService.name);

  constructor(
    @Inject(CarsService) private readonly cars: CarsService,
    @Inject(IngestionFiles) private readonly files: IngestionFiles,
  ) {}

  /**
   * The files to keep in the car, as they are (no conversion): the
   * certificate of the policy in force and the latest revisione, one file
   * each, to print only what changed.
   */
  async inCar(vehicleId: string): Promise<Download<Readable>> {
    const today = todayIso();
    const { vehicle, filenames } = await this.cars.exportData(vehicleId, today);
    const name = carNameOf(vehicle);
    const root = safeFileName(`Documenti in auto - ${name}`);
    const unique = uniquePaths();
    const files = vehicle.archive.items
      .filter((item) => item.action === 'in_car')
      .flatMap((item) =>
        item.printFiles.map((file) => ({
          uploadId: file.uploadId,
          path: unique(
            inCarPath(
              root,
              item,
              file.title,
              filenames.get(file.uploadId) ?? '',
            ),
          ),
        })),
      );
    return {
      filename: `${today} - ${root}.zip`,
      body: await this.zip(root, files, []),
    };
  }

  async workbook(vehicleId: string): Promise<Download<Buffer>> {
    const today = todayIso();
    const { vehicle } = await this.cars.exportData(vehicleId, today);
    const name = carNameOf(vehicle);
    return {
      filename: `Riepilogo documenti auto - ${safeFileName(name)}.xlsx`,
      body: await this.workbookBuffer(vehicle, name, today),
    };
  }

  /** What to keep (in the car and at home), one folder per kind, with the summary. */
  async archive(vehicleId: string): Promise<Download<Readable>> {
    const today = todayIso();
    const { vehicle, filenames } = await this.cars.exportData(vehicleId, today);
    const name = carNameOf(vehicle);
    const root = safeFileName(`Documenti auto - ${name}`);
    const unique = uniquePaths();
    const kept = vehicle.archive.items
      .filter((item) => item.action !== 'discard')
      .flatMap((item) =>
        item.files.map((file) => ({
          uploadId: file.uploadId,
          path: unique(
            archivePath(
              root,
              item,
              file.title,
              filenames.get(file.uploadId) ?? '',
            ),
          ),
        })),
      );
    return {
      filename: `${today} - ${root}.zip`,
      body: await this.zip(root, kept, [
        {
          path: `${root}/Riepilogo documenti.xlsx`,
          body: await this.workbookBuffer(vehicle, name, today),
        },
      ]),
    };
  }

  /** The files, read from svc-ingestion as they are, and a note naming any that could not be. */
  private async zip(
    root: string,
    files: { uploadId: string; path: string }[],
    extra: { path: string; body: Buffer }[],
  ): Promise<Readable> {
    const zip = new JSZip();
    for (const file of extra) zip.file(file.path, file.body);
    const bytes = await this.readAll(files.map((f) => f.uploadId));
    const missing: string[] = [];
    for (const file of files) {
      const body = bytes.get(file.uploadId);
      if (body) zip.file(file.path, body);
      else missing.push(file.path.slice(root.length + 1));
    }
    if (missing.length)
      zip.file(
        `${root}/DOCUMENTI NON DISPONIBILI.txt`,
        'Questi file non erano disponibili al momento del download:\r\n\r\n' +
          missing.map((line) => `- ${line}`).join('\r\n') +
          '\r\n',
      );
    return zip.generateNodeStream({
      type: 'nodebuffer',
      streamFiles: true,
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    }) as Readable;
  }

  private async workbookBuffer(
    vehicle: VehicleDto,
    name: string,
    today: string,
  ): Promise<Buffer> {
    const workbook = buildCarDocumentsWorkbook(vehicle, name, today);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Each file once, four at a time; a file that cannot be read is left out. */
  private async readAll(uploadIds: string[]): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    const queue = [...new Set(uploadIds)];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          out.set(id, await this.files.read(id));
        } catch (error) {
          this.logger.warn(`Could not read document ${id}: ${String(error)}`);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  }
}
