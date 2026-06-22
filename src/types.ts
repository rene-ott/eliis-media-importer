/**
 * Type definitions for the ELIIS guardian-feed API and the local SQLite rows.
 *
 * The API frequently omits fields, so most properties are optional/nullable.
 * Field names mirror the raw JSON exactly (snake_case) for the API shapes.
 */

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface Thumbnail {
  id?: number;
  file_id?: number;
  diary_id?: number;
  filename?: string;
  type?: string;
  created_at?: string;
  updated_at?: string;
  url?: string;
}

export interface ApiMediaFile {
  id?: number;
  filename?: string | null;
  name?: string | null;
  description?: string | null;
  mime_type?: string | null;
  /** Byte size — the API sends this as a string, e.g. "2727723". */
  size?: string | number | null;
  uploaded_at?: string | null;
  url?: string | null;
  thumbnails?: {
    small?: Thumbnail;
    medium?: Thumbnail;
    [key: string]: Thumbnail | undefined;
  } | null;
}

export interface Summary {
  id?: number;
  /** HTML string, e.g. "<p>Täna ...</p>". */
  comment?: string | null;
}

export interface DiaryText {
  id?: number;
  summaries?: Summary[];
  images?: ApiMediaFile[];
  /** Non-media attachments — captured for completeness, not imported. */
  documents?: unknown[];
}

export interface Diary {
  id?: number;
  course?: string | null;
  texts?: DiaryText[];
  comment?: string | null;
  status?: unknown;
}

export interface FeedDay {
  date: string;
  diaries?: Diary[];
  evaluations?: unknown[];
}

export interface GuardianFeedResponse {
  data: FeedDay[];
  /** Primary pagination cursor (date to request next). */
  next_date?: string | null;
  /** Defensive alias — some deployments may use camelCase. */
  nextDate?: string | null;
}

// ---------------------------------------------------------------------------
// Database row shapes
// ---------------------------------------------------------------------------

export type RequestStatus = 'pending' | 'success' | 'error';

export interface RequestRow {
  id: number;
  param_date: string;
  current_date: string | null;
  next_date: string | null;
  status: RequestStatus;
  success: number;
  attempt_count: number;
  http_status: number | null;
  error_message: string | null;
  duration_ms: number | null;
  media_file_count: number;
  raw_response_saved: number;
  raw_response_path: string | null;
  kindergarten_id: string | null;
  child_id: string | null;
  response_hash: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export type MediaKind = 'image' | 'video' | 'other';

export interface MediaFileRow {
  id: number;
  request_id: number;
  api_media_id: string | null;
  mime_type: string | null;
  media_kind: MediaKind;
  url: string | null;
  name: string | null;
  filename: string | null;
  description: string | null;
  summary_description: string | null;
  summary_html: string | null;
  feed_date: string | null;
  diary_id: number | null;
  text_id: number | null;
  uploaded_at: string | null;
  size: number | null;
  thumbnail_small_url: string | null;
  thumbnail_medium_url: string | null;
  raw_json: string | null;
  created_at: string;
}

/**
 * A media record extracted from a response, before it is persisted.
 * (No `id`/`request_id`/`created_at` yet — those are assigned at insert time.)
 */
export type ExtractedMedia = Omit<MediaFileRow, 'id' | 'request_id' | 'created_at'>;
