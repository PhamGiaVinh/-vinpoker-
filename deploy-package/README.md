# Deploy Package

**Migrations** — deployment copies for Supabase migrations.
**Shared** — deployment copies for shared utilities.

## ⚠️ Functions removed

`deploy-package/functions/` has been **deleted** as of Sprint 3.

**Source of truth**: `VinPoker/supabase/functions/`
**Deploy command**: `npm run deploy:functions` (from `VinPoker/`)

The deploy-package was a manual copy that consistently fell out of sync with the source, causing 4 bugs across 3 sprints. Deploy directly from source now.
