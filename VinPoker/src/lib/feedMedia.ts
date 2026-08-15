export const FEED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const FEED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export const FEED_MEDIA_ACCEPT = [...FEED_IMAGE_MIME_TYPES, ...FEED_VIDEO_MIME_TYPES].join(",");

export const FEED_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const FEED_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

export type FeedMediaKind = "image" | "video";
export type FeedMediaValidationError = "unsupported_type" | "too_large";

export function getFeedMediaKind(file: Pick<File, "type">): FeedMediaKind | null {
  if ((FEED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return "image";
  if ((FEED_VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) return "video";
  return null;
}

export function validateFeedMediaFile(file: Pick<File, "type" | "size">): FeedMediaValidationError | null {
  const kind = getFeedMediaKind(file);
  if (!kind) return "unsupported_type";
  return file.size > (kind === "video" ? FEED_VIDEO_MAX_BYTES : FEED_IMAGE_MAX_BYTES)
    ? "too_large"
    : null;
}
