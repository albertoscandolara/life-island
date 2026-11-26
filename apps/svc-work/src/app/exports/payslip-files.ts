import type {
  CareerDocumentDto,
  PayslipKind,
  WorkOverviewDto,
  WorkplaceDto,
} from '@life-island/contracts';
import {
  fileExtension,
  safeFileName,
  uniquePaths,
} from '@life-island/be-common';

/** What a payslip pays, in the words printed on it. */
const KIND_NAMES: Record<PayslipKind, string> = {
  regular: 'Cedolino',
  thirteenth: 'Tredicesima',
  fourteenth: 'Quattordicesima',
  other: 'Cedolino aggiuntivo',
};

/** The name a workplace goes by in a file name: its label, else its employer. */
export function workplaceFileName(workplace: WorkplaceDto): string {
  const employer =
    typeof workplace.values.employerName === 'string'
      ? workplace.values.employerName.trim()
      : '';
  return workplace.label?.trim() || employer || 'Lavoro';
}

/**
 * A readable name for a work document's file, so a folder of them sorts by
 * month: "2026-10 - Cedolino - Acme.pdf", "CU 2025 - Acme.pdf", else
 * "2026-03-01 - <title>.pdf".
 */
export function documentFileName(
  document: Pick<
    CareerDocumentDto,
    'type' | 'period' | 'payslipKind' | 'title'
  >,
  workplace: string,
  originalFilename: string,
  cuYear: number | null = null,
): string {
  const ext = fileExtension(originalFilename);
  if (document.type === 'PAYSLIP')
    return (
      safeFileName(
        [
          document.period?.slice(0, 7),
          KIND_NAMES[document.payslipKind ?? 'regular'],
          workplace,
        ]
          .filter(Boolean)
          .join(' - '),
      ) + ext
    );
  if (document.type === 'CERTIFICAZIONE_UNICA')
    return (
      safeFileName([`CU${cuYear ? ` ${cuYear}` : ''}`, workplace].join(' - ')) +
      ext
    );
  return (
    safeFileName(
      [document.period, document.title].filter(Boolean).join(' - '),
    ) + ext
  );
}

/** One document of the overview, with its workplace. */
export interface FoundDocument {
  document: CareerDocumentDto;
  workplace: WorkplaceDto;
}

export function findDocument(
  overview: Pick<WorkOverviewDto, 'workplaces'>,
  uploadId: string,
): FoundDocument | null {
  for (const workplace of overview.workplaces) {
    const document = workplace.documents.find((d) => d.uploadId === uploadId);
    if (document) return { document, workplace };
  }
  return null;
}

/**
 * The files of one year's payslips (every workplace, the month paid in that
 * year) and the Certificazioni Uniche about that year's income, one folder,
 * sorted by month. A copy of a payslip you approved twice goes in once.
 */
export function payslipYearFiles(
  overview: Pick<WorkOverviewDto, 'workplaces' | 'certificates'>,
  year: number,
  filenames: ReadonlyMap<string, string>,
  root: string,
): { uploadId: string; path: string }[] {
  const unique = uniquePaths();
  const cuYear = new Map(
    overview.certificates.map((c) => [c.uploadId, c.year]),
  );
  const seen = new Set<string>();
  const files: { uploadId: string; path: string; sort: string }[] = [];
  for (const workplace of overview.workplaces) {
    const name = workplaceFileName(workplace);
    for (const document of workplace.documents) {
      const isPayslip =
        document.type === 'PAYSLIP' &&
        document.period?.startsWith(`${year}-`) === true;
      const isCu =
        document.type === 'CERTIFICAZIONE_UNICA' &&
        cuYear.get(document.uploadId) === year;
      if (!isPayslip && !isCu) continue;
      const key = isPayslip
        ? [
            workplace.id,
            document.period,
            document.payslipKind,
            document.payslipKind === 'other' ? document.gross : '',
          ].join('|')
        : document.uploadId;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({
        uploadId: document.uploadId,
        sort: isPayslip ? (document.period ?? '') : `9999 ${name}`,
        path: documentFileName(
          document,
          name,
          filenames.get(document.uploadId) ?? '',
          cuYear.get(document.uploadId) ?? null,
        ),
      });
    }
  }
  return files
    .sort(
      (a, b) => a.sort.localeCompare(b.sort) || a.path.localeCompare(b.path),
    )
    .map((f) => ({ uploadId: f.uploadId, path: unique(`${root}/${f.path}`) }));
}
