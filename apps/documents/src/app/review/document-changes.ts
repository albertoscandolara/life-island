import type {
  CategoryDecisions,
  ExtractedField,
  UpdateUploadRequest,
  UploadDto,
} from '@life-island/contracts';

/** What changed, for the inbox to show at once (the review service catches up a moment later). */
export interface DocumentChanges {
  uploadId: string;
  title: string;
  description: string | null;
  categories: string[];
}

/** A field value as the text in its input. */
export function fieldText(field: ExtractedField): string {
  if (field.value === null) return '';
  if (typeof field.value === 'boolean') return field.value ? 'yes' : 'no';
  return String(field.value);
}

/** The edits worth sending: only what differs from the stored document. */
export function uploadChanges(
  upload: UploadDto,
  form: {
    title: string;
    description: string;
    categories: string[];
    fields: Record<string, string>;
  },
): UpdateUploadRequest {
  const changes: UpdateUploadRequest = {};
  if (form.title.trim() !== upload.title) changes.title = form.title.trim();
  if (form.description.trim() !== (upload.description ?? ''))
    changes.description = form.description.trim() || null;
  if (form.categories.join() !== upload.categories.join())
    changes.categories = form.categories;
  const fields: Record<string, string | null> = {};
  for (const [key, field] of Object.entries(
    upload.extractedFields?.fields ?? {},
  )) {
    const text = form.fields[key];
    if (text !== undefined && text.trim() !== fieldText(field))
      fields[key] = text.trim() || null;
  }
  if (Object.keys(fields).length) changes.fields = fields;
  return changes;
}

/** Ticked or not, per suggestion id (parser) or category id (later check). */
export type Picks = Record<string, boolean>;

/**
 * The decisions the final Confirm applies: ticked suggestions are confirmed
 * (all in one operation, so the taxonomy version goes up once), unticked ones
 * declined for this document; the same for the findings of a later check.
 * Undefined when there is nothing to decide.
 */
export function categoryDecisions(
  suggestionIds: string[],
  suggestionPicks: Picks,
  historicalIds: string[],
  historicalPicks: Picks,
): CategoryDecisions | undefined {
  if (!suggestionIds.length && !historicalIds.length) return undefined;
  const picked = (picks: Picks, id: string) => picks[id] ?? true;
  return {
    approveSuggestions: suggestionIds.filter((id) =>
      picked(suggestionPicks, id),
    ),
    declineSuggestions: suggestionIds.filter(
      (id) => !picked(suggestionPicks, id),
    ),
    acceptHistorical: historicalIds.filter((id) => picked(historicalPicks, id)),
    rejectHistorical: historicalIds.filter(
      (id) => !picked(historicalPicks, id),
    ),
  };
}
