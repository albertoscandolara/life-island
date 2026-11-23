import type {
  DossierExpenseDto,
  Tax730AttachmentDto,
  TaxYearDossierDto,
} from '@life-island/contracts';
import {
  fileExtension as extensionOf,
  safeFileName as safeName,
  uniquePaths,
} from '@life-island/be-common';

export { safeName };

const ROLE_SUFFIX: Record<Tax730AttachmentDto['role'], string> = {
  INVOICE: 'Fattura',
  PAYMENT: 'Dettaglio bonifico',
  CERTIFICATION: 'Certificazione',
  RETURN: 'Dichiarazione',
  OTHER: 'Documento',
};

/** One file to put in the zip: which document, and where. */
export interface DossierFile {
  uploadId: string;
  path: string;
}

/**
 * Where each document goes in the commercialista's folder, as in
 * "730/2026/2025-07-01 - 10-25 - Unitycasa - Compenso mediazione/…":
 * one folder per expense ("date - invoice no. - supplier - description")
 * holding its invoice and payment proof, each named after its own date, and
 * the year's documents (Certificazione Unica) at the top.
 */
export function dossierFiles(
  dossier: TaxYearDossierDto,
  root: string,
): { files: DossierFile[]; missing: string[] } {
  const files: DossierFile[] = [];
  const missing: string[] = [];
  const unique = uniquePaths();

  for (const attachment of dossier.yearDocuments) {
    const document = attachment.document;
    if (!document || document.deleted) {
      missing.push(
        `${ROLE_SUFFIX[attachment.role]} dell'anno (documento eliminato)`,
      );
      continue;
    }
    files.push({
      uploadId: attachment.uploadId,
      path: unique(
        `${root}/${safeName(document.title)}${extensionOf(document.originalFilename)}`,
      ),
    });
  }

  for (const expense of dossier.expenses) {
    const folder = expenseFolder(expense);
    if (!expense.hasInvoice) missing.push(`${folder}: manca la fattura`);
    if (!expense.hasPaymentProof)
      missing.push(`${folder}: manca il dettaglio del bonifico`);
    for (const attachment of expense.attachments) {
      const document = attachment.document;
      if (!document || document.deleted) {
        missing.push(
          `${folder}: ${ROLE_SUFFIX[attachment.role]} eliminata dai documenti`,
        );
        continue;
      }
      const date =
        document.date ??
        (attachment.role === 'INVOICE'
          ? expense.date
          : document.uploadedAt.slice(0, 10));
      const name = safeName(
        `${date} - ${expense.issuer} - ${expense.description ?? ''} - ${ROLE_SUFFIX[attachment.role]}`,
      );
      files.push({
        uploadId: attachment.uploadId,
        path: unique(
          `${root}/${folder}/${name}${extensionOf(document.originalFilename)}`,
        ),
      });
    }
  }
  return { files, missing };
}

export function expenseFolder(expense: DossierExpenseDto): string {
  return safeName(
    [expense.date, expense.documentNumber, expense.issuer, expense.description]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' - '),
  );
}

/** The zip's top folder: the 730 it is for and the year of the expenses. */
export function dossierRoot(dossier: TaxYearDossierDto): string {
  return `730 ${dossier.filingYear} - redditi ${dossier.taxYear}`;
}
