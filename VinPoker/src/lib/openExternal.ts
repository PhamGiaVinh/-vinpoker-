export const isIOS = () =>
  typeof navigator !== "undefined" &&
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(window as any).MSStream;

const isAndroid = () =>
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/**
 * Detect in-app browsers (Facebook, Messenger, Instagram, Zalo, Line, WeChat, TikTok, ...)
 * where Add-to-Home-Screen / PWA install does not work.
 */
export const isInAppBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|MicroMessenger|Zalo|TikTok|musical_ly|Snapchat|KAKAOTALK|Twitter|LinkedInApp/i.test(
    ua
  );
};

/**
 * Try to open the current URL in the device's real external browser
 * (Safari on iOS, Chrome on Android). Falls back to window.open.
 */
export const openInExternalBrowser = (targetUrl?: string) => {
  const url = targetUrl || window.location.href;
  if (isIOS()) {
    const safariUrl = url.replace(/^https?:\/\//, "x-safari-https://");
    window.location.href = safariUrl;
    setTimeout(() => window.open(url, "_blank", "noopener,noreferrer"), 400);
  } else if (isAndroid()) {
    const noScheme = url.replace(/^https?:\/\//, "");
    const intentUrl = `intent://${noScheme}#Intent;scheme=https;package=com.android.chrome;end`;
    window.location.href = intentUrl;
    setTimeout(() => window.open(url, "_blank", "noopener,noreferrer"), 400);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
};
