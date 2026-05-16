# VBacker

A poker tournament discovery, staking, and bankroll-management web app built
on React + Vite + Lovable Cloud.

## Quick Start

```bash
git clone <repo-url>
cd <repo>
npm install     # also installs Playwright chromium for E2E (postinstall)
npm run dev     # starts Vite dev server on http://localhost:8080
```

## Common scripts

| Command              | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| `npm run dev`        | Start dev server                                       |
| `npm run build`      | Production build                                       |
| `npm test`           | Run unit tests (Vitest)                                |
| `npm run test:e2e`   | Run Playwright E2E tests (needs `.env.local` setup)    |
| `npm run analyze`    | Build with bundle visualizer → `dist/stats.html`       |
| `npm run lint`       | ESLint                                                 |

## Documentation

- **[Testing & Monitoring guide](docs/testing.md)** — unit tests, E2E setup,
  health check endpoint, Sentry, and bundle analysis.

## Tech stack

React 18 · Vite 5 · TypeScript 5 · Tailwind CSS · shadcn/ui · TanStack Query ·
Lovable Cloud (Supabase) · Recharts · i18next · Playwright · Vitest.
