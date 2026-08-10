[CmdletBinding()]
param(
  [string]$Target = ".local-data/vinpoker-test-canonical-v1",
  [switch]$ResetTarget
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$sourceMigrations = Join-Path $repoRoot 'VinPoker/supabase/migrations'
$compatRoot = Join-Path $PSScriptRoot 'compat'
$targetRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Target))
$allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.local-data'))

if (-not $targetRoot.StartsWith($allowedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Target must stay under $allowedRoot"
}

if (Test-Path -LiteralPath $targetRoot) {
  if (-not $ResetTarget) {
    throw "Target exists. Re-run with -ResetTarget for this disposable TEST path only."
  }
  $resolved = (Resolve-Path -LiteralPath $targetRoot).Path
  if (-not $resolved.StartsWith($allowedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove a path outside .local-data'
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
& supabase init --workdir $targetRoot
if ($LASTEXITCODE -ne 0) { throw "supabase init failed: $LASTEXITCODE" }

$targetSupabase = Join-Path $targetRoot 'supabase'
$targetMigrations = Join-Path $targetSupabase 'migrations'
New-Item -ItemType Directory -Path $targetMigrations -Force | Out-Null
Copy-Item -Path (Join-Path $sourceMigrations '*.sql') -Destination $targetMigrations -Force

foreach ($excluded in @(
  '20260609000002_recalculate_june_payroll.sql',
  '20270103000004_retention_cleanup_schedules.sql'
)) {
  $path = Join-Path $targetMigrations $excluded
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}

$relativeMigrationTarget = $targetMigrations.Substring($repoRoot.Length).TrimStart('\', '/').Replace('\', '/')
$catalogPatch = Join-Path $compatRoot 'catalog.patch'
# Catalog migrations are SQL text. Preserve the TEST-only semantic transforms while
# allowing harmless CRLF/final-newline normalization in the canonical catalog.
& git -C $repoRoot apply --check --ignore-space-change --directory=$relativeMigrationTarget $catalogPatch
if ($LASTEXITCODE -ne 0) { throw 'Compatibility patch check failed; canonical catalog changed.' }
& git -C $repoRoot apply --ignore-space-change --directory=$relativeMigrationTarget $catalogPatch
if ($LASTEXITCODE -ne 0) { throw 'Compatibility patch apply failed.' }

Copy-Item -LiteralPath (Join-Path $compatRoot '20260604999999_test_compat_dealer_assignments_club_id.sql') -Destination $targetMigrations -Force
Copy-Item -LiteralPath (Join-Path $compatRoot '20260608599999_test_compat_remote_payroll_baseline.sql') -Destination $targetMigrations -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'seed.sql') -Destination (Join-Path $targetSupabase 'seed.sql') -Force

$roles = @'
-- VINPOKER_TEST only: historical catalog uses cron before its first tracked CREATE EXTENSION.
CREATE EXTENSION IF NOT EXISTS pg_cron;
'@
[System.IO.File]::WriteAllText((Join-Path $targetSupabase 'roles.sql'), $roles, [System.Text.UTF8Encoding]::new($false))

$configPath = Join-Path $targetSupabase 'config.toml'
$config = [System.IO.File]::ReadAllText($configPath)
$config = [regex]::Replace($config, '(?m)^project_id\s*=.*$', 'project_id = "vinpoker-test-canonical-v1"')
$config = [regex]::Replace($config, '(?m)^major_version\s*=.*$', 'major_version = 17')
[System.IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))

$productionRef = 'orlesggc' + 'jamwuknxwcpk'
$productionUrl = 'https://' + $productionRef + '.supabase.co'
Get-ChildItem -LiteralPath $targetMigrations -Filter '*.sql' | ForEach-Object {
  $sql = [System.IO.File]::ReadAllText($_.FullName)
  $sql = $sql.Replace($productionUrl, 'http://127.0.0.1:54321')
  $sql = $sql.Replace($productionRef, 'VINPOKER_TEST')
  [System.IO.File]::WriteAllText($_.FullName, $sql, [System.Text.UTF8Encoding]::new($false))
}

$forbiddenPatterns = @(
  [regex]::Escape($productionRef),
  ('https://' + '[^\s''"]+' + '\.supabase\.co'),
  ('sbp_' + '[A-Za-z0-9]'),
  ('sb_secret_' + '[A-Za-z0-9]')
)
$unsafe = Get-ChildItem -LiteralPath $targetSupabase -Recurse -File |
  Select-String -Pattern $forbiddenPatterns
if ($unsafe) { throw 'Production target or credential-like value remains in generated TEST environment.' }

Write-Output "VINPOKER_TEST prepared: $targetRoot"
