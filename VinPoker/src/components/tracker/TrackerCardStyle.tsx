import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type TrackerCardStyle = 'classic' | 'four-color';
type CardStyleContext = { style: TrackerCardStyle; setStyle?: (style: TrackerCardStyle) => void };
const Context = createContext<CardStyleContext | undefined>(undefined);
export const TRACKER_CARD_STYLE_KEY = 'vinpoker.tracker.card-style';
const changeEvent = 'vinpoker:tracker-card-style';
let memoryStyle: TrackerCardStyle = 'four-color';

function readStyle(): TrackerCardStyle {
  try {
    const saved = localStorage.getItem(TRACKER_CARD_STYLE_KEY);
    return saved === 'classic' ? 'classic' : 'four-color';
  } catch { return memoryStyle; }
}
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(changeEvent, callback);
  };
}
function saveStyle(style: TrackerCardStyle) {
  memoryStyle = style;
  try { localStorage.setItem(TRACKER_CARD_STYLE_KEY, style); } catch { /* Restricted storage: keep session choice. */ }
  window.dispatchEvent(new Event(changeEvent));
}

export function useTrackerCardStyle() { return useContext(Context); }

export function TrackerInputCardProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={{ style: 'four-color' }}>{children}</Context.Provider>;
}

export function TrackerViewerCardProvider({ children }: { children: ReactNode }) {
  const inherited = useTrackerCardStyle();
  const style = useSyncExternalStore(subscribe, readStyle, () => 'four-color' as const);
  return <Context.Provider value={inherited ?? { style, setStyle: saveStyle }}>{children}</Context.Provider>;
}

export function TrackerCardStyleToggle() {
  const context = useTrackerCardStyle();
  const { t } = useTranslation();
  if (!context?.setStyle) return null;
  return <div role="group" aria-label={t('trackerCards.deck')} className="inline-flex shrink-0 rounded-xl border border-border bg-card/70 p-0.5">
    {(['four-color', 'classic'] as const).map(style => <button key={style} type="button"
      aria-pressed={context.style === style} onClick={() => context.setStyle?.(style)}
      className={`min-h-11 rounded-lg px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${context.style === style ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
      {t(style === 'four-color' ? 'trackerCards.fourColor' : 'trackerCards.classic')}
    </button>)}
  </div>;
}
