[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$LocalDbUrl
)

$ErrorActionPreference = 'Stop'

# This harness creates only fixed ca63... throwaway rows and refuses any
# non-local target. It proves the order that #908 originally did not cover:
# cleanup locks first, then an assignment/pre-assignment writer starts.
$dbUri = [Uri]$LocalDbUrl
if ($dbUri.Host -notin @('127.0.0.1', 'localhost', '::1')) {
  throw 'Refusing non-local database. Use a local Supabase/PostgreSQL URL only.'
}

$psqlPath = (Get-Command psql -ErrorAction Stop).Source
$clubId = 'ca630000-0000-0000-0000-000000000001'
$targetDealerId = 'ca630000-0000-0000-0000-0000000000a1'
$targetAttendanceId = 'ca630000-0000-0000-0000-0000000000b1'
$targetTableId = 'ca630000-0000-0000-0000-0000000000c1'
$targetAssignmentId = 'ca630000-0000-0000-0000-0000000000d1'
$sourceDealerId = 'ca630000-0000-0000-0000-0000000000a2'
$sourceAttendanceId = 'ca630000-0000-0000-0000-0000000000b2'
$sourceTableId = 'ca630000-0000-0000-0000-0000000000c2'
$sourceAssignmentId = 'ca630000-0000-0000-0000-0000000000d2'

function Invoke-LocalPsql {
  param([Parameter(Mandatory)][string]$Sql)

  $Sql | & $psqlPath --dbname=$LocalDbUrl -X -q -v ON_ERROR_STOP=1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Local psql command failed.'
  }
}

function Invoke-LocalScalar {
  param([Parameter(Mandatory)][string]$Sql)

  $value = $Sql | & $psqlPath --dbname=$LocalDbUrl -X -q -t -A -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) {
    throw 'Local psql scalar command failed.'
  }
  return ($value | Select-Object -Last 1).Trim()
}

function Start-LocalPsqlJob {
  param([Parameter(Mandatory)][string]$Sql)

  Start-Job -ScriptBlock {
    param($Psql, $DatabaseUrl, $JobSql)
    $output = @($JobSql | & $Psql --dbname=$DatabaseUrl -X -q -v ON_ERROR_STOP=1 2>&1)
    [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = ($output | Out-String).Trim()
    }
  } -ArgumentList $psqlPath, $LocalDbUrl, $Sql
}

function Complete-LocalPsqlJob {
  param(
    [Parameter(Mandatory)]$Job,
    [Parameter(Mandatory)][bool]$ExpectSuccess,
    [Parameter(Mandatory)][string]$Label
  )

  Wait-Job -Job $Job -Timeout 12 | Out-Null
  if ($Job.State -ne 'Completed') {
    Stop-Job -Job $Job -ErrorAction SilentlyContinue
    throw "$Label did not finish within 12 seconds (possible deadlock)."
  }

  $result = Receive-Job -Job $Job
  Remove-Job -Job $Job -Force -ErrorAction SilentlyContinue
  $succeeded = $result.ExitCode -eq 0
  if ($succeeded -ne $ExpectSuccess) {
    throw "$Label unexpected exit=$($result.ExitCode): $($result.Output)"
  }
  return $result
}

function Wait-ForCleanupLock {
  param([Parameter(Mandatory)][int]$LockKey)

  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  while ([DateTime]::UtcNow -lt $deadline) {
    # If the cleanup job owns the transaction-level advisory lock this returns
    # "locked". If it is free, take+release it immediately and retry.
    $state = Invoke-LocalScalar @"
SELECT CASE
  WHEN pg_try_advisory_lock($LockKey) THEN pg_advisory_unlock($LockKey)::text
  ELSE 'locked'
END;
"@
    if ($state -eq 'locked') {
      return
    }
    Start-Sleep -Milliseconds 50
  }
  throw 'Cleanup job did not signal that the attendance row is locked.'
}

function Reset-Fixture {
  param([Parameter(Mandatory)][string]$TargetState)

  Invoke-LocalPsql "DELETE FROM public.clubs WHERE id = '$clubId'::uuid;"
  Invoke-LocalPsql @"
INSERT INTO public.clubs (id, name, region)
VALUES ('$clubId', '__cleanup_reverse_race__', 'test');
INSERT INTO public.dealers (id, club_id, full_name, tier)
VALUES ('$targetDealerId', '$clubId', '__cleanup_reverse_target__', 'C');
INSERT INTO public.game_tables (id, club_id, table_name, table_type, status)
VALUES ('$targetTableId', '$clubId', '__cleanup_reverse_target__', 'tournament', 'active');
INSERT INTO public.dealer_attendance (
  id, dealer_id, status, current_state, check_in_time, shift_date
) VALUES (
  '$targetAttendanceId', '$targetDealerId', 'checked_in', '$TargetState', now() - interval '7 days', current_date
);
"@
}

function Add-SourceLiveAssignment {
  Invoke-LocalPsql @"
INSERT INTO public.dealers (id, club_id, full_name, tier)
VALUES ('$sourceDealerId', '$clubId', '__cleanup_reverse_source__', 'C');
INSERT INTO public.game_tables (id, club_id, table_name, table_type, status)
VALUES ('$sourceTableId', '$clubId', '__cleanup_reverse_source__', 'tournament', 'active');
INSERT INTO public.dealer_attendance (
  id, dealer_id, status, current_state, check_in_time, shift_date
) VALUES (
  '$sourceAttendanceId', '$sourceDealerId', 'checked_in', 'assigned', now(), current_date
);
INSERT INTO public.dealer_assignments (
  id, attendance_id, dealer_id, club_id, table_id, status, assigned_at, swing_due_at
) VALUES (
  '$sourceAssignmentId', '$sourceAttendanceId', '$sourceDealerId', '$clubId', '$sourceTableId',
  'assigned', now(), now() + interval '45 minutes'
);
"@
}

function Start-CleanupFirst {
  param([Parameter(Mandatory)][int]$LockKey)

  return Start-LocalPsqlJob @"
BEGIN;
SELECT 1 FROM public.dealer_attendance
WHERE id = '$targetAttendanceId'::uuid
FOR UPDATE;
SELECT pg_advisory_xact_lock($LockKey);
SELECT pg_sleep(2);
SELECT public.cleanup_stale_attendance('$clubId'::uuid, 24);
COMMIT;
"@
}

function Assert-CleanupWon {
  Invoke-LocalPsql @"
DO `$`$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.dealer_attendance
    WHERE id = '$targetAttendanceId'::uuid
      AND status = 'checked_out'
      AND current_state = 'checked_out'
      AND check_out_time IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'cleanup did not win the reverse race';
  END IF;
END
`$`$;
"@
}

$jobs = @()
try {
  # R1 + R4 + R8: cleanup locks first; a direct service-role style INSERT must
  # finish with a clear rejection, no active row, and no deadlock/hang.
  Reset-Fixture -TargetState 'assigned'
  $cleanupJob = Start-CleanupFirst -LockKey 906301
  $jobs += $cleanupJob
  Wait-ForCleanupLock -LockKey 906301
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $writerJob = Start-LocalPsqlJob @"
INSERT INTO public.dealer_assignments (
  id, attendance_id, dealer_id, club_id, table_id, status, assigned_at, swing_due_at
) VALUES (
  '$targetAssignmentId', '$targetAttendanceId', '$targetDealerId', '$clubId', '$targetTableId',
  'assigned', now(), now() + interval '45 minutes'
);
"@
  $jobs += $writerJob
  Complete-LocalPsqlJob -Job $cleanupJob -ExpectSuccess $true -Label 'R1 cleanup-first direct binding cleanup'
  Complete-LocalPsqlJob -Job $writerJob -ExpectSuccess $false -Label 'R1 cleanup-first direct binding writer'
  $timer.Stop()
  if ($timer.Elapsed.TotalSeconds -gt 8) {
    throw 'R1 direct binding race exceeded deadlock timeout.'
  }
  Assert-CleanupWon
  Invoke-LocalPsql @"
DO `$`$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.dealer_assignments
    WHERE id = '$targetAssignmentId'::uuid AND released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'R1 direct writer created an active assignment after cleanup';
  END IF;
END
`$`$;
"@
  Write-Output 'PASS R1/R4/R8: cleanup-first direct binding rejected without deadlock.'
  $jobs = @()

  # R2: the same inverse race for pre_assigned_attendance_id. The source seat
  # is live; the target starts as an orphan stale pre-assignment, exactly the
  # shape cleanup is meant to repair.
  Reset-Fixture -TargetState 'pre_assigned'
  Add-SourceLiveAssignment
  $cleanupJob = Start-CleanupFirst -LockKey 906302
  $jobs += $cleanupJob
  Wait-ForCleanupLock -LockKey 906302
  $writerJob = Start-LocalPsqlJob @"
UPDATE public.dealer_assignments
SET pre_assigned_attendance_id = '$targetAttendanceId'::uuid,
    pre_assigned_at = now()
WHERE id = '$sourceAssignmentId'::uuid;
"@
  $jobs += $writerJob
  Complete-LocalPsqlJob -Job $cleanupJob -ExpectSuccess $true -Label 'R2 cleanup-first pre-assignment cleanup'
  Complete-LocalPsqlJob -Job $writerJob -ExpectSuccess $false -Label 'R2 cleanup-first pre-assignment writer'
  Assert-CleanupWon
  Invoke-LocalPsql @"
DO `$`$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.dealer_assignments
    WHERE id = '$sourceAssignmentId'::uuid
      AND pre_assigned_attendance_id = '$targetAttendanceId'::uuid
  ) THEN
    RAISE EXCEPTION 'R2 pre-assignment pointer survived after cleanup';
  END IF;
END
`$`$;
"@
  Write-Output 'PASS R2: cleanup-first pre-assignment pointer rejected.'
  $jobs = @()

  # R3: assign_dealer_to_table starts while cleanup holds its candidate row.
  # Its existing SKIP LOCKED contract returns conflict and never inserts.
  Reset-Fixture -TargetState 'assigned'
  $cleanupJob = Start-CleanupFirst -LockKey 906303
  $jobs += $cleanupJob
  Wait-ForCleanupLock -LockKey 906303
  Invoke-LocalPsql @"
DO `$`$
DECLARE result jsonb;
BEGIN
  result := public.assign_dealer_to_table(
    '$targetAttendanceId'::uuid,
    '$targetTableId'::uuid,
    now(),
    now() + interval '45 minutes',
    '$clubId'::uuid,
    '__cleanup_reverse_rpc__',
    false,
    false,
    null,
    null
  );
  IF result->>'outcome' IS DISTINCT FROM 'conflict' THEN
    RAISE EXCEPTION 'R3 expected assign conflict, got %', result;
  END IF;
END
`$`$;
"@
  Complete-LocalPsqlJob -Job $cleanupJob -ExpectSuccess $true -Label 'R3 cleanup-first RPC cleanup'
  Assert-CleanupWon
  Invoke-LocalPsql @"
DO `$`$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.dealer_assignments
    WHERE attendance_id = '$targetAttendanceId'::uuid AND released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'R3 assign_dealer_to_table inserted after cleanup lock';
  END IF;
END
`$`$;
"@
  Write-Output 'PASS R3: assign_dealer_to_table returned conflict with no insert.'
  $jobs = @()

  # R5/R6/R7: a live pre-assignment commits first. Cleanup waits, re-reads the
  # binding, and skips it. The resulting combined state stays valid.
  Reset-Fixture -TargetState 'available'
  Add-SourceLiveAssignment
  $preAssignJob = Start-LocalPsqlJob @"
BEGIN;
SELECT 1 FROM public.dealer_attendance
WHERE id = '$targetAttendanceId'::uuid
FOR UPDATE;
UPDATE public.dealer_assignments
SET pre_assigned_attendance_id = '$targetAttendanceId'::uuid,
    pre_assigned_at = now()
WHERE id = '$sourceAssignmentId'::uuid;
UPDATE public.dealer_attendance
SET current_state = 'pre_assigned', pre_assigned_table_id = '$sourceTableId'::uuid, pre_assigned_at = now()
WHERE id = '$targetAttendanceId'::uuid;
SELECT pg_advisory_xact_lock(906304);
SELECT pg_sleep(2);
COMMIT;
"@
  $jobs += $preAssignJob
  Wait-ForCleanupLock -LockKey 906304
  $cleanupJob = Start-LocalPsqlJob "SELECT public.cleanup_stale_attendance('$clubId'::uuid, 24);"
  $jobs += $cleanupJob
  Complete-LocalPsqlJob -Job $preAssignJob -ExpectSuccess $true -Label 'R5 pre-assignment-first writer'
  Complete-LocalPsqlJob -Job $cleanupJob -ExpectSuccess $true -Label 'R6 pre-assignment-first cleanup'
  Invoke-LocalPsql @"
DO `$`$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.dealer_attendance
    WHERE id = '$targetAttendanceId'::uuid
      AND status = 'checked_in'
      AND current_state = 'pre_assigned'
      AND check_out_time IS NULL
  ) THEN
    RAISE EXCEPTION 'R6 cleanup checked out the committed pre-assignment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.dealer_assignments
    WHERE id = '$sourceAssignmentId'::uuid
      AND status = 'assigned'
      AND released_at IS NULL
      AND pre_assigned_attendance_id = '$targetAttendanceId'::uuid
  ) THEN
    RAISE EXCEPTION 'R7 missing canonical live pre-assignment after race';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.dealer_assignments a
    JOIN public.dealer_attendance d ON d.id = a.pre_assigned_attendance_id
    WHERE a.id = '$sourceAssignmentId'::uuid
      AND d.status = 'checked_out'
  ) THEN
    RAISE EXCEPTION 'R7 invalid checked-out/pre-assigned combined state';
  END IF;
END
`$`$;
"@
  Write-Output 'PASS R5/R6/R7: pre-assignment-first binding survives cleanup.'
}
finally {
  foreach ($job in $jobs) {
    if ($job.State -eq 'Running') {
      Stop-Job -Job $job -ErrorAction SilentlyContinue
    }
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
  }
  try {
    Invoke-LocalPsql "DELETE FROM public.clubs WHERE id = '$clubId'::uuid;"
  } catch {
    Write-Warning "Fixture cleanup failed: $($_.Exception.Message)"
  }
}

Write-Output 'ALL CLEANUP REVERSE-RACE TESTS PASSED'
