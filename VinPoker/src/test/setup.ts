import "@testing-library/jest-dom";
import i18n from "@/i18n";

// Components in the viewer hub / felt now use react-i18next. Force a
// deterministic language (vi = the source strings) so render-test assertions on
// translated text + interpolation ("Ghế 5", "8 người chơi") are stable.
i18n.changeLanguage("vi");

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
