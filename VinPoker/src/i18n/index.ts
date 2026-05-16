import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import vi from "./locales/vi.json";
import zhCN from "./locales/zh-CN.json";
import ko from "./locales/ko.json";

const normalizeLng = (lng?: string | null): string => {
  if (!lng) return "vi";
  const l = lng.toLowerCase();
  if (l.startsWith("zh")) return "zh-CN";
  if (l.startsWith("ko")) return "ko";
  if (l.startsWith("en")) return "en";
  if (l.startsWith("vi")) return "vi";
  return "vi";
};

// Migrate any pre-existing stored value (e.g. "zh", "zh-cn", "en-US") to canonical code
try {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem("vinpoker.lang") : null;
  if (stored) {
    const norm = normalizeLng(stored);
    if (norm !== stored) localStorage.setItem("vinpoker.lang", norm);
  }
} catch {}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      vi: { translation: vi },
      "zh-CN": { translation: zhCN },
      ko: { translation: ko },
    },
    fallbackLng: "vi",
    supportedLngs: ["vi", "en", "zh-CN", "ko"],
    nonExplicitSupportedLngs: false,
    load: "all",
    lowerCaseLng: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "vinpoker.lang",
      convertDetectedLanguage: (lng: string) => normalizeLng(lng),
    },
  });

const syncHtmlLang = (lng: string) => {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("lang", lng || "vi");
  }
};
syncHtmlLang(i18n.language);
i18n.on("languageChanged", (lng) => {
  const norm = normalizeLng(lng);
  if (norm !== lng) {
    i18n.changeLanguage(norm);
    return;
  }
  syncHtmlLang(norm);
});

export default i18n;
