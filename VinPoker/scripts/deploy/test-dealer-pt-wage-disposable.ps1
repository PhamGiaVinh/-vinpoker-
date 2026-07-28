[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('16', '17')]
  [string]$PostgresMajor,
  [Parameter(Mandatory = $true)]
  [string]$SchemaPath
)

# Disposable-only payroll proof. The input must be a public-schema dump captured
# before this run; this script never links to or mutates a Supabase project.
$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $PSCommandPath
$vinPokerRoot = Split-Path -Parent (Split-Path -Parent $scriptRoot)
$containerName = "dealer-pt-wage-pg$PostgresMajor-$PID"
$preparedSchemaPath = Join-Path ([System.IO.Path]::GetTempPath()) "dealer-pt-wage-pg$PostgresMajor-$PID-schema.sql"

function Invoke-Docker {
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw "docker failed: $($args -join ' ')" }
}

function Invoke-ContainerPsql {
  param([string]$FilePath)
  Invoke-Docker exec $containerName psql -X -q -v ON_ERROR_STOP=1 -U postgres -d vinpoker -f $FilePath
}

if (-not (Test-Path -LiteralPath $SchemaPath -PathType Leaf)) {
  throw "Schema dump not found: $SchemaPath"
}

Push-Location $vinPokerRoot
try {
  node (Join-Path $scriptRoot 'verify-dealer-pt-wage-migration-inventory.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'PT wage migration inventory check failed' }
} finally {
  Pop-Location
}

try {
  Invoke-Docker run --name $containerName -d `
    -e POSTGRES_HOST_AUTH_METHOD=trust `
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
    '/tmp/v2.sql' = Join-Path $vinPokerRoot 'supabase\migrations\20270106000001_dealer_pt_wage_global_continuous_accrual_v2.sql'
    '/tmp/activation-gap.sql' = Join-Path $vinPokerRoot 'supabase\tests\dealer_pt_global_continuous_accrual_activation_gap.sql'
    '/tmp/activation-ready.sql' = Join-Path $vinPokerRoot 'supabase\tests\dealer_pt_global_continuous_accrual_activation_ready.sql'
    '/tmp/lifecycle.sql' = Join-Path $vinPokerRoot 'supabase\tests\dealer_pt_global_continuous_accrual.sql'
    '/tmp/concurrency.sql' = Join-Path $vinPokerRoot 'supabase\tests\dealer_pt_global_continuous_accrual_concurrency.sql'
  }
  foreach ($destination in $files.Keys) { Invoke-Docker cp $files[$destination] "${containerName}:$destination" }

  Invoke-ContainerPsql '/tmp/bootstrap.sql'
  Invoke-ContainerPsql '/tmp/live-public.sql'
  Invoke-ContainerPsql '/tmp/support.sql'

  # Prove the pre-v2 baseline has no global writer, then install the complete
  # v2 contract and prove the exact request succeeds. Reapplying v2 verifies
  # idempotent DDL/function replacement without broad migration replay.
  Invoke-ContainerPsql '/tmp/activation-gap.sql'
  Invoke-ContainerPsql '/tmp/v2.sql'
  Invoke-ContainerPsql '/tmp/activation-ready.sql'
  Invoke-ContainerPsql '/tmp/v2.sql'
  Invoke-ContainerPsql '/tmp/lifecycle.sql'
  Invoke-ContainerPsql '/tmp/concurrency.sql'

  Write-Host "Dealer PT wage PG$PostgresMajor current-schema restore, ordered migration apply/reapply, ACL, lifecycle, immutability, and concurrency suites passed."
} finally {
  if (Test-Path -LiteralPath $preparedSchemaPath) { Remove-Item -LiteralPath $preparedSchemaPath -Force }
  $existing = & docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq $containerName }
  if ($existing) { & docker rm -f $containerName | Out-Null }
}
