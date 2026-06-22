/**
 * Extract media records from a parsed guardian-feed response.
 *
 * Walks data[] -> diaries[] -> texts[] -> images[] and flattens every item
 * into an {@link ExtractedMedia}, regardless of MIME type (the API calls them
 * `images` but they include videos and potentially other media).
 */

import type {
  ApiMediaFile,
  ExtractedMedia,
  GuardianFeedResponse,
  MediaKind,
} from './types.ts';
import { combineSummariesHtml, combineSummariesPlain } from './utils/html.ts';

export function mediaKindFromMime(mime: string | null | undefined): MediaKind {
  if (!mime) return 'other';
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  return 'other';
}

/** Parse the API's stringified byte size into a number, or null. */
function parseSize(size: ApiMediaFile['size']): number | null {
  if (size == null) return null;
  const n = typeof size === 'number' ? size : Number(size);
  return Number.isFinite(n) ? n : null;
}

function idToString(id: number | string | null | undefined): string | null {
  if (id == null) return null;
  const s = String(id).trim();
  return s.length > 0 ? s : null;
}

/**
 * Extract every media file from a response. The result preserves the order in
 * which items appear in the feed (day -> diary -> text -> image).
 */
export function extractMedia(response: GuardianFeedResponse): ExtractedMedia[] {
  const out: ExtractedMedia[] = [];
  const days = Array.isArray(response.data) ? response.data : [];

  for (const day of days) {
    const feedDate = day?.date ?? null;
    const diaries = day?.diaries ?? [];

    for (const diary of diaries) {
      const diaryId = typeof diary?.id === 'number' ? diary.id : null;
      const texts = diary?.texts ?? [];

      for (const text of texts) {
        const textId = typeof text?.id === 'number' ? text.id : null;
        const summaryPlain = combineSummariesPlain(text?.summaries);
        const summaryHtml = combineSummariesHtml(text?.summaries);
        const images = text?.images ?? [];

        for (const image of images) {
          const thumbs = image?.thumbnails ?? null;
          out.push({
            api_media_id: idToString(image?.id),
            mime_type: image?.mime_type ?? null,
            media_kind: mediaKindFromMime(image?.mime_type),
            url: image?.url ?? null,
            name: image?.name ?? null,
            filename: image?.filename ?? null,
            description: image?.description ?? null,
            summary_description: summaryPlain,
            summary_html: summaryHtml,
            feed_date: feedDate,
            diary_id: diaryId,
            text_id: textId,
            uploaded_at: image?.uploaded_at ?? null,
            size: parseSize(image?.size),
            thumbnail_small_url: thumbs?.small?.url ?? null,
            thumbnail_medium_url: thumbs?.medium?.url ?? null,
            raw_json: JSON.stringify(image),
          });
        }
      }
    }
  }

  return out;
}

/** Read the pagination cursor, preferring `next_date` and falling back to `nextDate`. */
export function getNextDate(response: GuardianFeedResponse): string | null {
  const next = response.next_date ?? response.nextDate ?? null;
  if (next == null) return null;
  const trimmed = String(next).trim();
  return trimmed.length > 0 ? trimmed : null;
}
