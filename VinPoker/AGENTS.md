# VinPoker

Poker tournament platform. Dark theme (#0A0A0A), emerald accent (#10B981).

## Tech Stack

- Vite + React 18 + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (project: orlesggcjamwuknxwcpk)
- React Query (TanStack Query v5)
- React Router v6 (lazy loading)
- i18next

## i18n Setup

- **Library**: i18next + react-i18next + i18next-browser-languagedetector
- **Fallback**: Vietnamese (vi)
- **Locales** (6): `vi`, `en`, `zh-CN`, `ko`, `ja`, `th`
- **Files**: `src/i18n/locales/{locale}.json`
- **Config**: `src/i18n/index.ts`
- **Switcher**: `src/components/LanguageSwitcher.tsx`
- **Auto-prompt**: `src/components/LanguagePrompt.tsx`

## Translation Workflow (Manual — Current)

When I provide content in Vietnamese or English:
1. I add/update the key in the source locale (vi or en)
2. I simultaneously populate the same keys in ALL 5 remaining locales
3. Convention: user-facing strings translated naturally; admin keys (`admin.*`) stay English
4. After updating locales, run `npm run build` to verify

## Translation Workflow (API — Future)

When `scripts/translate-i18n.mjs` is connected to OpenAI:
1. Add keys to source locale (vi or en)
2. Run: `node scripts/translate-i18n.mjs --source vi`
3. Script auto-translates all target locales via OpenAI
4. Run `npm run build`

## Adding a New Locale

1. Create `src/i18n/locales/{code}.json` (copy en.json, prefix all values with `[{CODE}]`)
2. Import in `src/i18n/index.ts` + add to `resources` + `supportedLngs` + `normalizeLng`
3. Add to `src/components/LanguageSwitcher.tsx`

## Key Naming

- Dot-separated, grouped by feature: `packages.listing.title`, `admin.packages.form.price`
- Same structure across all 6 files
- Admin keys (`admin.*`) kept in English across all locales

## Language Detection

- `LanguageSwitcher.tsx` — manual selection, stored in `localStorage` key `vinpoker.lang`
- `LanguagePrompt.tsx` — auto-detects browser language (zh-CN/ko/ja/th) and prompts to switch

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->

## Agent skills

### Issue tracker

GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.
