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

## CodeGraph

CodeGraph builds a semantic knowledge graph of codebases for faster, smarter code exploration.

### If `.codegraph/` exists in the project

**Answer directly with CodeGraph — don't delegate exploration to a file-reading sub-agent or a grep/read loop.** CodeGraph *is* the pre-built search index; re-deriving its answers with grep + Read repeats work it already did and costs more for the same result. For "how does X work?", architecture, trace, or where-is-X questions, answer in a handful of CodeGraph calls and stop — typically with **zero file reads**. The returned source is complete and authoritative: treat it as already read and do not re-open those files. Reach for raw Read/Grep only to confirm a specific detail CodeGraph didn't cover.

**Tool selection by intent:**

| Tool | Use For |
|------|---------|
| `codegraph_context` | Map a task / feature / area first — composes search + node + callers + callees in one call |
| `codegraph_trace` | "How does X reach Y" — the call path, each hop's body inline |
| `codegraph_explore` | Survey several related symbols' source in ONE budget-capped call |
| `codegraph_search` | Find a symbol by name |
| `codegraph_callers` / `codegraph_callees` | Walk call flow one hop at a time |
| `codegraph_impact` | Check what's affected before editing |
| `codegraph_node` | Get a single symbol's source / signature |
| `codegraph_files` | Get indexed file structure (faster than filesystem scanning) |
| `codegraph_status` | Check index health and statistics |

## Agent skills

### Issue tracker

GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.

---

## Design Standard — Taste Skill (v2 experimental)

Installed at `.agents/skills/design-taste-frontend/SKILL.md`. Load via `skill(name="design-taste-frontend")`.

**All future UI work must load taste-skill and follow its rules.**

### Key rules for VinPoker (dashboard-adapted)

| Rule | Applies |
|---|---|
| Anti-placeholder, no TODO comments, full implementation | ✅ Always |
| Color consistency — one accent (#10B981 emerald) per page | ✅ Always |
| Shape consistency — one corner-radius system per page | ✅ Always |
| WCAG AA contrast on all CTAs | ✅ Always |
| Icons: Phosphor > HugeIcons > Radix > Tabler (Lucide discouraged) | ✅ Migrate gradually |
| Motion via `motion/react` (framer-motion rebrand), GSAP for scroll effects | ✅ New motion work |
| No `window.addEventListener('scroll')` — use Motion `whileInView` | ✅ Always |
| Reduced motion support for `MOTION_INTENSITY > 3` | ✅ Always |
| `transform`/`opacity` only for animation (no top/left/width/height) | ✅ Always |
| Em-dash ban, section-number eyebrows, decorative dots | ⚠️ Landing pages only |
| Hero rules, section-layout ban, trusted-by walls | ❌ Dashboard-specific UI skip |

### Dial defaults for VinPoker (dashboard context)

```json
{ "DESIGN_VARIANCE": 3,   "MOTION_INTENSITY": 2, "VISUAL_DENSITY": 7 }
```

Dashboard = high density, low variance, restrained motion. Override per feature when appropriate.

### When to load

For any frontend work involving **new UI components, pages, or significant redesign of existing views**, load taste-skill as:
```typescript
task(category="visual-engineering", load_skills=["design-taste-frontend"], prompt="...")
```
