// Helpers to safely parse / build embed URLs for YouTube and Facebook livestreams.
// Whitelist domains and reject everything else to avoid arbitrary iframe src.

export type StreamPlatform = "youtube" | "facebook";

function parseYoutubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1) || null;
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(?:embed|live|shorts)\/([\w-]+)/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

function isValidFacebookUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");
    return host === "facebook.com" || host === "m.facebook.com" || host === "fb.watch" || host === "web.facebook.com";
  } catch {
    return false;
  }
}

export function buildEmbedSrc(platform: StreamPlatform, url: string, opts?: { autoplay?: boolean }): string | null {
  const autoplay = opts?.autoplay ?? false;
  if (platform === "youtube") {
    const id = parseYoutubeId(url);
    if (!id) return null;
    const origin = typeof window !== "undefined" ? encodeURIComponent(window.location.origin) : "";
    const ap = autoplay ? "&autoplay=1&mute=1" : "";
    // enablejsapi=1: cho phép postMessage điều khiển play/unmute mà không remount iframe.
    // KHÔNG dùng loop=1 + playlist= cho livestream: với live, YouTube xem là "loop" video duy nhất
    // và mỗi lần buffer/seek lại nó tự reset về tham số khởi tạo (gồm mute=1) → bị mute mỗi vài giây.
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&disablekb=1&enablejsapi=1${ap}${origin ? `&origin=${origin}` : ""}`;
  }
  if (platform === "facebook") {
    if (!isValidFacebookUrl(url)) return null;
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&autoplay=${autoplay ? "true" : "false"}&mute=${autoplay ? "true" : "false"}`;
  }
  return null;
}

export function validateStreamUrl(platform: StreamPlatform, url: string): { ok: boolean; embedId?: string; error?: string } {
  if (platform === "youtube") {
    const id = parseYoutubeId(url);
    if (!id) return { ok: false, error: "Link YouTube không hợp lệ. Hãy dùng dạng youtube.com/watch?v=… hoặc youtu.be/…" };
    return { ok: true, embedId: id };
  }
  if (!isValidFacebookUrl(url)) return { ok: false, error: "Link Facebook không hợp lệ. Hãy dùng link gốc của video Facebook." };
  return { ok: true };
}
