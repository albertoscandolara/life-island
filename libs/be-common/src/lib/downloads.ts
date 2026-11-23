/*
 * What every area's downloads share: the file name in the response, safe
 * file and folder names inside a zip, and the look of the Excel summaries
 * (euro format, a green ✓ or a red ✗, the table style of the 730's
 * "Riepilogo detrazioni"). Kept free of the exceljs import, so the styles are
 * plain objects any sheet can take.
 */

/** `attachment; filename=…` with a UTF-8 name and an ASCII fallback. */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Makes a string safe as a file or folder name on Windows, macOS and Linux. */
export function safeFileName(name: string, max = 150): string {
  const cleaned = name
    .replace(/[/\\]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
  return cleaned || 'documento';
}

/** The extension of a file name, lower-case with its dot ("" when none). */
export function fileExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename);
  return match ? `.${match[1].toLowerCase()}` : '';
}

/**
 * Hands out file paths once each (case-insensitively, as Windows sees them):
 * a second "Bollo.pdf" becomes "Bollo (2).pdf".
 */
export function uniquePaths(): (path: string) => string {
  const taken = new Set<string>();
  return (path) => {
    let candidate = path;
    const ext = fileExtension(path);
    const stem = ext ? path.slice(0, -ext.length) : path;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++)
      candidate = `${stem} (${n})${ext}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  };
}

/** Euro amounts in an Excel cell, Italian style. */
export const EXCEL_EURO = '#,##0.00 [$€-410]';

/** The table style of every summary: blue header, banded rows, filters. */
export const EXCEL_TABLE_STYLE = {
  theme: 'TableStyleMedium2',
  showRowStripes: true,
} as const;

/** A green ✓ (yes, filed, to keep) or a red ✗ in an Excel cell. */
export function excelMark(yes: boolean): {
  value: string;
  font: { bold: boolean; color: { argb: string } };
} {
  return yes
    ? { value: '✓', font: { bold: true, color: { argb: 'FF1E8449' } } }
    : { value: '✗', font: { bold: true, color: { argb: 'FFC0392B' } } };
}
