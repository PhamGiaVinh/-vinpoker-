[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('16', '17')]
  [string]$PostgresMajor,
  [Parameter(Mandatory = $true)]
  [string]$SchemaPath,
  [string]$RollbackTargetRoot = 'D:\wt\dealer-swing-rollback-1fdc210',
  [switch]$SkipFrontendContractProbe
)

$ErrorActionPreference = 'Stop'
$expectedRollbackSha = '1fdc210d4ae1689091e0ad874c559592b0ecd690'
$scriptRoot = Split-Path -Parent $PSCommandPath
$vinPokerRoot = Split-Path -Parent (Split-Path -Parent $scriptRoot)
$workspaceRoot = Split-Path -Parent $vinPokerRoot
$containerName = "dealer-swing-drift-pg$PostgresMajor-$PID"
$catalogPath = Join-Path ([System.IO.Path]::GetTempPath()) "dealer-swing-drift-pg$PostgresMajor-$PID-catalog.json"
$preparedSchemaPath = Join-Path ([System.IO.Path]::GetTempPath()) "dealer-swing-drift-pg$PostgresMajor-$PID-schema.sql"

function Invoke-Docker {
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw "docker failed: $($args -join ' ')" }
}

function Invoke-ContainerPsql {
  param([string]$FilePath)
  Invoke-Docker exec $containerName psql -X -q -v ON_ERROR_STOP=1 -U postgres -d vinpoker -f $FilePath
}

if (-not (Test-Path -LiteralPath $SchemaPath -PathType Leaf)) { throw "Schema dump not found: $SchemaPath" }
if ((git -C $RollbackTargetRoot rev-parse HEAD).Trim() -ne $expectedRollbackSha) {
  throw "Rollback target must be the verified exact SHA $expectedRollbackSha"
}

try {
  $existing = & docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq $containerName }
  if ($existing) { Invoke-Docker rm -f $containerName | Out-Null }
  Invoke-Docker run --name $containerName -d `
    -e POSTGRES_PASSWORD=local-disposable-only `
    -e POSTGRES_DB=vinpoker `
    -e POSTGRES_USER=postgres `
    "postgres:$PostgresMajor" | Out-Null

  $ready = $false
  for ($attempt = 0; $attempt -lt 45; $attempt += 1) {
    & docker exec $containerName pg_isready -U postgres -d vinpoker 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "PostgreSQL $PostgresMajor did not become ready" }

  node (Join-Path $scriptRoot 'prepare-disposable-schema-dump.mjs') `
    --input $SchemaPath `
    --output $preparedSchemaPath `
    --postgres-major $PostgresMajor
  if ($LASTEXITCODE -ne 0) { throw "Could not prepare PostgreSQL $PostgresMajor disposable schema input" }

  $files = @{
    '/tmp/bootstrap.sql' = Join-Path $scriptRoot 'disposable-public-schema-bootstrap.sql'
    '/tmp/live-public.sql' = (Resolve-Path -LiteralPath $preparedSchemaPath)
    '/tmp/support.sql' = Join-Path $scriptRoot 'disposable-public-schema-support.sql'
    '/tmp/20270104000002.sql' = Join-Path $vinPokerRoot 'supabase\migrations\20270104000002_dealer_swing_contract_drift.sql'
    '/tmp/20270104000003.sql' = Join-Path $vinPokerRoot 'supabase\migrations\20270104000003_dealer_shift_metrics_contract.sql'
    '/tmp/20270104000006.sql' = Join-Path $vinPokerRoot 'supabase\migrations\20270104000006_dealer_shortage_alert_lifecycle.sql'
    '/tmp/dealer_swing_contract_drift.sql' = Join-Path $vinPokerRoot 'tests\dealer_swing_contract_drift.sql'
    '/tmp/dealer_shift_metrics_contract.sql' = Join-Path $vinPokerRoot 'tests\dealer_shift_metrics_contract.sql'
    '/tmp/dealer_shortage_alert_lifecycle.sql' = Join-Path $vinPokerRoot 'supabase\tests\dealer_shortage_alert_lifecycle.sql'
  }
  foreach ($destination in $files.Keys) { Invoke-Docker cp $files[$destination] "${containerName}:$destination" }

  Invoke-ContainerPsql '/tmp/bootstrap.sql'
  Invoke-ContainerPsql '/tmp/live-public.sql'
  Invoke-ContainerPsql '/tmp/support.sql'
  Invoke-ContainerPsql '/tmp/20270104000002.sql'
  Invoke-ContainerPsql '/tmp/20270104000003.sql'
  Invoke-ContainerPsql '/tmp/20270104000006.sql'
  Invoke-ContainerPsql '/tmp/20270104000002.sql'
  Invoke-ContainerPsql '/tmp/20270104000003.sql'
  Invoke-ContainerPsql '/tmp/20270104000006.sql'
  Invoke-ContainerPsql '/tmp/dealer_swing_contract_drift.sql'
  Invoke-ContainerPsql '/tmp/dealer_shift_metrics_contract.sql'
  Invoke-ContainerPsql '/tmp/dealer_shortage_alert_lifecycle.sql'

  Push-Location $vinPokerRoot
  try {
    node --input-type=module -e "import { CATALOG_SQL } from './scripts/deploy/capture-live-schema-contract-catalog.mjs'; process.stdout.write(CATALOG_SQL);" |
      docker exec -i $containerName sh -c 'psql -X -q -t -A -v ON_ERROR_STOP=1 -U postgres -d vinpoker > /tmp/catalog.json'
    if ($LASTEXITCODE -ne 0) { throw 'Disposable catalog query failed' }
    Invoke-Docker cp "${containerName}:/tmp/catalog.json" $catalogPath

    node scripts/deploy/probe-live-schema-contracts.mjs `
      --catalog $catalogPath `
      --targets process-swing,mass-assign,checkout-dealer `
      --target-root $workspaceRoot
    if ($LASTEXITCODE -ne 0) { throw 'Current Edge catalog probe failed' }
    if (-not $SkipFrontendContractProbe) {
      node scripts/deploy/probe-live-schema-contracts.mjs `
        --catalog $catalogPath `
        --targets frontend `
        --target-root $workspaceRoot
      if ($LASTEXITCODE -ne 0) { throw 'Current frontend catalog probe failed' }
    } else {
      Write-Host 'Frontend catalog probe skipped for a documented historical schema dump; Edge/DB probes remain required.'
    }
    node scripts/deploy/probe-live-schema-contracts.mjs `
      --catalog $catalogPath `
      --targets process-swing,mass-assign,checkout-dealer `
      --target-root $RollbackTargetRoot
    if ($LASTEXITCODE -ne 0) { throw 'Legacy Edge catalog probe failed' }
    if (-not $SkipFrontendContractProbe) {
      node scripts/deploy/probe-live-schema-contracts.mjs `
        --catalog $catalogPath `
        --targets frontend `
        --target-root $RollbackTargetRoot
      if ($LASTEXITCODE -ne 0) { throw 'Legacy frontend catalog probe failed' }
    }
  } finally {
    Pop-Location
  }

  Write-Host "Dealer Swing PG$PostgresMajor disposable restore, migration, reapply, SQL suites, and catalog probes passed."
} finally {
  if (Test-Path -LiteralPath $catalogPath) { Remove-Item -LiteralPath $catalogPath -Force }
  if (Test-Path -LiteralPath $preparedSchemaPath) { Remove-Item -LiteralPath $preparedSchemaPath -Force }
  $existing = & docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq $containerName }
  if ($existing) { & docker rm -f $containerName | Out-Null }
}
