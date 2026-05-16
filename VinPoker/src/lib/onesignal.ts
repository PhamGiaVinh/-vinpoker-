// OneSignal Web Push integration.
// Loads the v16 SDK from CDN, guards against iframes / Lovable preview hosts,
// and exposes simple helpers for topic subscription and user linking.

const ONESIGNAL_APP_ID = "a54eec09-b2a7-4773-9a75-719695aa059d";

declare global {
  interface Window {
    OneSignal?: OneSignalSDK;
    OneSignalDeferred?: Array<(OneSignal: OneSignalSDK) => void | Promise<void>>;
  }
}

type OneSignalSDK = {
  init?: (options: Record<string, unknown>) => Promise<void>;
  login?: (userId: string) => Promise<void>;
  logout?: () => Promise<void>;
  Notifications?: {
    permission?: boolean | "granted" | "denied" | "default";
    permissionNative?: "granted" | "denied" | "default";
    requestPermission?: () => Promise<void>;
  };
  User?: {
    externalId?: string;
    addTag?: (key: string, value: string) => Promise<void>;
    addTags?: (tags: Record<string, string>) => Promise<void>;
    getTags?: () => Promise<Record<string, string>>;
    PushSubscription?: {
      optedIn?: boolean;
      optIn?: () => Promise<void>;
      optOut?: () => Promise<void>;
    };
  };
};

let initPromise: Promise<OneSignalSDK | null> | null = null;

const isBlockedEnv = () => {
  if (typeof window === "undefined") return true;
  let inIframe = false;
  try {
    inIframe = window.self !== window.top;
  } catch {
    inIframe = true;
  }
  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host === "localhost" ||
    host === "127.0.0.1";
  return inIframe || isPreviewHost;
};

export const isOneSignalSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "Notification" in window &&
  "PushManager" in window;

export const isIOSDevice = () =>
  typeof navigator !== "undefined" &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !(window as Window & { MSStream?: unknown }).MSStream;

export const isStandalonePWA = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

const loadScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load OneSignal SDK"));
    document.head.appendChild(s);
  });

export const initOneSignal = async (): Promise<OneSignalSDK | null> => {
  if (isBlockedEnv()) return null;
  if (!isOneSignalSupported()) return null;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      await loadScript("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js");
      return await new Promise<OneSignalSDK | null>((resolve) => {
        window.OneSignalDeferred!.push(async (OneSignal: OneSignalSDK) => {
          try {
            await OneSignal.init({
              appId: ONESIGNAL_APP_ID,
              serviceWorkerPath: "OneSignalSDKWorker.js",
              serviceWorkerParam: { scope: "/" },
              // We use our own custom prompt — disable the default slidedown.
              promptOptions: { slidedown: { prompts: [] } },
              allowLocalhostAsSecureOrigin: false,
              notifyButton: { enable: false },
            });
          } catch (e) {
            console.warn("[OneSignal] init failed", e);
          }
          resolve(OneSignal);
        });
      });
    } catch (e) {
      console.warn("[OneSignal] load failed", e);
      return null;
    }
  })();

  return initPromise;
};

const withOS = async (): Promise<OneSignalSDK | null> => {
  const os = await initOneSignal();
  return os || null;
};

const readBrowserPermission = (os?: OneSignalSDK): "granted" | "denied" | "default" => {
  if (typeof Notification !== "undefined") {
    const nativePermission = Notification.permission;
    if (
      nativePermission === "granted" ||
      nativePermission === "denied" ||
      nativePermission === "default"
    ) {
      return nativePermission;
    }
  }

  const oneSignalNative = os?.Notifications?.permissionNative;
  if (
    oneSignalNative === "granted" ||
    oneSignalNative === "denied" ||
    oneSignalNative === "default"
  ) {
    return oneSignalNative;
  }

  return os?.Notifications?.permission === true ? "granted" : "default";
};

export type Topic = "tournaments" | "news" | "tools";
const TOPIC_TAG: Record<Topic, string> = {
  tournaments: "topic_tournaments",
  news: "topic_news",
  tools: "topic_tools",
};

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T | undefined> =>
  Promise.race([
    p,
    new Promise<undefined>((resolve) =>
      setTimeout(() => {
        console.warn(`[OneSignal] ${label} timed out after ${ms}ms`);
        resolve(undefined);
      }, ms),
    ),
  ]);

export const requestPushPermission = async (
  topics: Topic[] = ["tournaments", "news", "tools"],
  lang?: string,
): Promise<boolean> => {
  const os = await withOS();
  if (!os) return false;
  try {
    // Only prompt if permission is still "default". Calling requestPermission
    // when the browser already decided can hang on some Chromium builds.
    let perm = readBrowserPermission(os);
    if (perm === "default") {
      // Use the native API directly — OneSignal's wrapper sometimes never resolves.
      if (typeof Notification !== "undefined" && Notification.requestPermission) {
        try {
          const result = await withTimeout(
            Promise.resolve(Notification.requestPermission()),
            15000,
            "Notification.requestPermission",
          );
          if (result) perm = result as "granted" | "denied" | "default";
        } catch (e) {
          console.warn("[OneSignal] native requestPermission failed", e);
        }
      } else {
        await withTimeout(
          Promise.resolve(os.Notifications?.requestPermission?.()),
          15000,
          "OneSignal.requestPermission",
        );
        perm = readBrowserPermission(os);
      }
    }

    const granted = perm === "granted";
    if (granted) {
      // Don't let optIn / addTags block the UI — they can be slow on first subscribe.
      await withTimeout(
        Promise.resolve(os.User?.PushSubscription?.optIn?.()),
        10000,
        "PushSubscription.optIn",
      );
      const tags: Record<string, string> = {};
      (Object.keys(TOPIC_TAG) as Topic[]).forEach((t) => {
        tags[TOPIC_TAG[t]] = topics.includes(t) ? "1" : "0";
      });
      if (lang) tags.lang = lang;
      // Fire-and-forget tags so UI returns immediately after subscribe.
      void withTimeout(
        Promise.resolve(os.User?.addTags?.(tags)),
        10000,
        "User.addTags",
      );
    }
    return granted;
  } catch (e) {
    console.warn("[OneSignal] requestPermission failed", e);
    return false;
  }
};

export const setTopic = async (topic: Topic, enabled: boolean) => {
  const os = await withOS();
  if (!os) return;
  await os.User?.addTag?.(TOPIC_TAG[topic], enabled ? "1" : "0");
};

export const setLanguageTag = async (lang: string) => {
  const os = await withOS();
  if (!os) return;
  await os.User?.addTag?.("lang", lang);
};

export const getSubscriptionState = async (): Promise<{
  permission: "granted" | "denied" | "default";
  optedIn: boolean;
  tags: Record<string, string>;
}> => {
  const os = await withOS();
  if (!os) return { permission: "default", optedIn: false, tags: {} };
  const permission = readBrowserPermission(os);
  let optedIn = false;
  try {
    optedIn = !!os.User?.PushSubscription?.optedIn;
  } catch (e) {
    console.warn("[OneSignal] read optedIn failed", e);
  }
  let tags: Record<string, string> = {};
  try {
    tags = (await os.User?.getTags?.()) || {};
  } catch (e) {
    console.warn("[OneSignal] read tags failed", e);
  }
  return { permission, optedIn, tags };
};

export const optOutPush = async () => {
  const os = await withOS();
  if (!os) return;
  try {
    await os.User?.PushSubscription?.optOut?.();
  } catch (e) {
    console.warn("[OneSignal] optOut failed", e);
  }
};

export const optInPush = async () => {
  const os = await withOS();
  if (!os) return;
  try {
    await os.User?.PushSubscription?.optIn?.();
  } catch (e) {
    console.warn("[OneSignal] optIn failed", e);
  }
};

export const linkUser = async (userId: string) => {
  const os = await withOS();
  if (!os) return;
  try {
    await os.login?.(userId);
  } catch (e) {
    console.warn("[OneSignal] login failed", e);
  }
};

export const logoutUser = async () => {
  const os = await withOS();
  if (!os) return;
  try {
    await os.logout?.();
  } catch (e) {
    console.warn("[OneSignal] logout failed", e);
  }
};
