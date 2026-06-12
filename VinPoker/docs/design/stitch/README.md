# Stitch UI — Usage Rules for VinPoker

> Status: Phase 0 reference (Session 6 — Global UI/UX Mapping). This doc distills
> `VinPoker/.claude/skills/stitch-ui/SKILL.md` into the rules every UI session must follow.
> It is read-only guidance — it grants no file-edit permissions.

## What Stitch is for

Stitch is a **visual ideation source**, not a component library and not a code source.

Use it for:

- Layout hierarchy ideas (dashboards, operator screens, poker UI)
- Spacing systems and visual rhythm
- Component composition patterns (cards, metric rows, action panels)
- Mobile behavior references
- Visual polish: empty states, loading states, error states
- Color/typography inspiration **within** the PokerVN Stitch Dark palette

## Hard rules

1. **Never paste Stitch HTML/CSS into the app.** Understand the intent, then rebuild
   with VinPoker's stack: React + TypeScript + Tailwind + shadcn/ui.
2. **Never add Stitch (or any new UI library) as a dependency.**
3. **Never break the existing design system.** Tokens live in `src/index.css` and
   `tailwind.config.ts`. New visuals must use those tokens — no hardcoded hex colors.
4. **Preserve PokerVN Stitch Dark globally.** Neon green primary `#00FF88`
   (`hsl(152 100% 50%)`), dark base, high contrast. Red felt / burgundy casino styling is
   allowed **only** inside explicit poker-table visual components (e.g. future
   `PokerTable3D`), never as a global theme.
5. **Stitch is inspiration, the Master Map is law.** Scope, ownership, and phase come from
   `docs/design/uiux-master-map.md` and `docs/design/uiux-roadmap.md`.

## Translation workflow

1. Query Stitch for the pattern you need (e.g. "operator table monitoring dashboard").
2. Analyze the design intent: hierarchy, spacing, flow — not the markup.
3. Map to VinPoker primitives: shadcn/ui components + Tailwind tokens
   (`bg-card`, `text-primary`, `border-border`, `gradient-card`, `shadow-neon`, …).
4. Build in TypeScript/React inside your session's allowed files only.
5. Verify at 360–390 px, tablet, and desktop widths.

## Local Stitch assets

- `VinPoker/public/stitch-preview/luxury-poker-schedule-redesign/` — exported Stitch
  concept (index.html + screenshot.jpg + metadata.json). Reference only; **unrouted** in
  the app except via the experimental `src/pages/StitchSchedulePreview.tsx` mockup
  (class F — do not ship as-is).

## Relationship to the other design docs

| Doc | Controls |
| --- | --- |
| `docs/design/uiux-master-map.md` | Product structure, roles, IA, global design rules |
| `docs/design/uiux-screen-inventory.md` | Every screen, its owner, risk class (A–F) |
| `docs/design/uiux-roadmap.md` | Phase sequence, allowed/forbidden files per phase |
| `docs/design/stitch/README.md` (this file) | How to use Stitch safely |
