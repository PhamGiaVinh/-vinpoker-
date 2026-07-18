[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$LocalDbUrl
)

$ErrorActionPreference = 'Stop'

# This harness intentionally refuses a non-local database. It writes only fixed
# throwaway rows and removes them on completion, but must never be aimed at prod.
$dbUri = [Uri]$LocalDbUrl
if ($dbUri.Host -notin @('127.0.0.1', 'localhost', '::1')) {
  throw 'Refusing non-local database. Use a local Supabase/PostgreSQL URL only.'
}

$psqlPath = (Get-Command psql -ErrorAction Stop).Source
$clubId = 'ca620000-0000-0000-0000-000000000001'
$dealerId = 'ca620000-0000-0000-0000-0000000000a1'
$attendanceId = 'ca620000-0000-0000-0000-0000000000b1'
$tableId = 'ca620000-0000-0000-0000-0000000000c1'
$assignmentId = 'ca620000-0000-0000-0000-0000000000d1'

function Invoke-LocalPsql {
  param([Parameter(Mandatory)][string]$Sql)

  $Sql | & $psqlPath --dbname=$LocalDbUrl -X -q -v ON_ERROR_STOP=1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Local psql command failed.'
  }
}

$cleanupSql = "DELETE FROM public.clubs WHERE id = '$clubId'::uuid;"
$setupSql = @"
INSERT INTO public.clubs (id, name, region)
VALUES ('$clubId', '__cleanup_race__', 'test');
INSERT INTO public.dealers (id, club_id, full_name, tier)
VALUES ('$dealerId', '$clubId', '__cleanup_race__', 'C');
INSERT INTO public.game_tables (id, club_id, table_name, table_type, status)
VALUES ('$tableId', '$clubId', '__cleanup_race__', 'tournament', 'active');
INSERT INTO public.dealer_attendance (id, dealer_id, status, current_state, check_in_time, shift_date)
VALUES ('$attendanceId', '$dealerId', 'checked_in', 'assigned', now() - interval '7 days', current_date);
"@

$writerSql = @"
BEGIN;
SELECT 1 FROM public.dealer_attendance WHERE id = '$attendanceId'::uuid FOR UPDATE;
INSERT INTO public.dealer_assignments (id, attendance_id, dealer_id, club_id, table_id, status, assigned_at, swing_due_at)
VALUES ('$assignmentId', '$attendanceId', '$dealerId', '$clubId', '$tableId', 'assigned', now() - interval '4 hours', now() - interval '3 hours');
SELECT pg_sleep(3);
COMMIT;
"@

$assertSql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.dealer_attendance
    WHERE id = '$attendanceId'::uuid AND status = 'checked_in'
      AND current_state = 'assigned' AND check_out_time IS NULL
  ) THEN
    RAISE EXCEPTION 'race failure: cleanup checked out attendance after live assignment committed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.dealer_assignments
    WHERE id = '$assignmentId'::uuid AND status = 'assigned' AND released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'race failure: cleanup released the live assignment';
  END IF;
END
`$`$;
"@

$writerJob = $null
try {
  Invoke-LocalPsql $cleanupSql
  Invoke-LocalPsql $setupSql

  $writerJob = Start-Job -ScriptBlock {
    param($Psql, $DatabaseUrl, $Sql)
    $Sql | & $Psql --dbname=$DatabaseUrl -X -q -v ON_ERROR_STOP=1 | Out-Null
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } -ArgumentList $psqlPath, $LocalDbUrl, $writerSql

  Start-Sleep -Milliseconds 400
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  Invoke-LocalPsql "SELECT public.cleanup_stale_attendance('$clubId'::uuid, 24);"
  $timer.Stop()

  Wait-Job -Job $writerJob | Out-Null
  Receive-Job -Job $writerJob | Out-Null
  if ($writerJob.State -ne 'Completed') {
    throw 'Concurrent assignment writer did not complete.'
  }
  if ($timer.Elapsed.TotalMilliseconds -lt 1500) {
    throw 'Cleanup did not wait for the concurrent attendance lock.'
  }

  Invoke-LocalPsql $assertSql
  Write-Output 'PASS: cleanup race protection preserved the live assignment.'
}
finally {
  if ($null -ne $writerJob) {
    Remove-Job -Job $writerJob -Force -ErrorAction SilentlyContinue
  }
  Invoke-LocalPsql $cleanupSql
}
