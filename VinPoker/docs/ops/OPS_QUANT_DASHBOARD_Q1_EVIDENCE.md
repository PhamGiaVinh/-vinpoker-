# Ops Quant Dashboard Q1 Evidence

## Source receipt

- Base: `2cb341f0f0648c47a96651a14807cfca566b3c87`
- Branch: `codex/ops-quant-dashboard-q1`
- Runtime flag: `opsQuantDashboardQ1=true`
- Surface: `/ops/select-module`, Owner/Super Admin, desktop `>=1280px`
- Delivery scope: frontend-only, read-only
- No DB, migration, RPC, Edge, Gemini, route, package, polling, Realtime, or money-write change

## Authority limits

- Forecast output is labeled `RESEARCH MODEL - HISTORY FINALITY UNVERIFIED` and remains a hypothesis.
- The chart renders observed registration plus terminal forecast-horizon markers; it does not draw a projected intraday curve.
- Capacity compares demand with exact selected-event table/dealer allocation. Club-wide inventory is context only.
- Prize-pool parsing preserves observed zero and fails closed on malformed or missing payloads.
- The V dock is a deterministic artifact explanation and does not call Gemini.
- Tablet and mobile preserve the legacy selector and mount no Q1 readers.

## Validation receipt

- Focused Vitest: 130/130 passed across 11 files.
- Playwright Q1 real-route mock: passed at 1440x900, 1920x1080, 1194x834, and 390x844.
- Existing Command Center and Q0 Playwright suites: passed.
- Protected Finance/Series Playwright suite: 3/3 passed with the current server-validated auth fixture.
- Targeted ESLint: passed.
- Focused Ops registry and Finance/Series TypeScript projects: passed.
- Ops boundary, money boundary, owner-digest boundary, V3 shell text, and credential-context guards: passed.
- Normal production build: passed.
- Constrained production build (`NODE_OPTIONS=--max-old-space-size=4096`, `GOMAXPROCS=2`): passed.
- Full app TypeScript command did not complete within the measurement window and is `NOT_MEASURED`; no diagnostics were emitted before termination.

## Deterministic screenshots

| Artifact | SHA-256 |
| --- | --- |
| `docs/ops/evidence/quant-q1/quant-1440x900.png` | `e325c9d497e68738e817f608fa5cb335ebb2aababf0a35b79c8a45d0a04e87cb` |
| `docs/ops/evidence/quant-q1/quant-1920x1080.png` | `01d1901d5e59eec848d5bc5eb69083766b6ca3cd2f5ef0f2248cc523ae06e60b` |
| `docs/ops/evidence/quant-q1/live-ops-embedded-1920x1080.png` | `9743f85a8cf5f6e84f9f85701a4f6f2b242cc7ba87f5b177eb8204cfefc38059` |
| `docs/ops/evidence/quant-q1/data-health-embedded-1920x1080.png` | `bbf5632a13b3924dc916e8f530818846e38de1bb36a0f34fd4f0337f478a0da5` |
| `docs/ops/evidence/quant-q1/mobile-fallback-390x844.png` | `d578037302ee642488a05495224450af60fc696c459a1c48041d25a3b95118fd` |

## Rollout boundary

This source receipt is not production evidence. After review and merge, deploy only the exact reviewed merge SHA through the protected frontend workflow and perform authenticated Owner/Super Admin smoke. The narrow rollback is `opsQuantDashboardQ1: true -> false` followed by the same exact-SHA workflow.
