import { describe, expect, it } from "vitest";
import {
  FEED_IMAGE_MAX_BYTES,
  FEED_VIDEO_MAX_BYTES,
  getFeedMediaKind,
  validateFeedMediaFile,
} from "./feedMedia";

describe("feed media validation", () => {
  it("accepts only the same MIME types and size limits configured for feed-media", () => {
    expect(getFeedMediaKind({ type: "image/webp" } as File)).toBe("image");
    expect(getFeedMediaKind({ type: "video/quicktime" } as File)).toBe("video");
    expect(validateFeedMediaFile({ type: "image/jpeg", size: FEED_IMAGE_MAX_BYTES } as File)).toBeNull();
    expect(validateFeedMediaFile({ type: "image/jpeg", size: FEED_IMAGE_MAX_BYTES + 1 } as File)).toBe("too_large");
    expect(validateFeedMediaFile({ type: "video/mp4", size: FEED_VIDEO_MAX_BYTES + 1 } as File)).toBe("too_large");
    expect(validateFeedMediaFile({ type: "image/svg+xml", size: 10 } as File)).toBe("unsupported_type");
  });
});
