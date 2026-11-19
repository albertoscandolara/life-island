import type { AiContentBlock } from './ai-assistant.js';

/** A file for the model to read: a PDF or a photo someone uploaded. */
export interface AiFile {
  name: string;
  contentType: string;
  data: Buffer;
}

/** A PDF or an image as the model reads it; null for any other kind of file. */
export function aiFileBlock(file: AiFile): AiContentBlock | null {
  const type = file.contentType.split(';')[0].trim().toLowerCase();
  const data = file.data.toString('base64');
  if (type === 'application/pdf')
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
      title: file.name,
    };
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp')
    return {
      type: 'image',
      source: { type: 'base64', media_type: type, data },
    };
  return null;
}
