# vinpoker-safety-guard.ps1
# Claude Code PreToolUse deny-first safety hook for VinPoker.
#
# Reads the PreToolUse hook JSON from stdin, extracts tool_input.command, and DENIES the call
# if it matches a dangerous production pattern (supabase db push / reset / migration up / functions
# deploy, vercel --prod, deploy_db=true, DROP TABLE|SCHEMA|DATABASE, TRUNCATE). It is a compensating
# control: it denies even when the allowlist would permit the command.
#
# Design: FAIL-OPEN. Any parse/exec error -> exit 0 (allow), so a bug here never bricks the workflow.
# Only an explicit dangerous-pattern match emits a deny decision. Everything else is allowed.
#
# Register in ~/.claude/settings.json hooks.PreToolUse (matchers Bash + PowerShell), invoking this
# file by ABSOLUTE path (e.g. %USERPROFILE%\.claude\hooks\vinpoker-safety-guard.ps1) so it fires in
# every session and every D:/wt/* worktree.

$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }   # nothing to inspect -> allow

    $payload = $raw | ConvertFrom-Json
    $command = ''
    if ($payload -and $payload.tool_input) {
        if ($payload.tool_input.command)  { $command = [string]$payload.tool_input.command }
        elseif ($payload.tool_input.script) { $command = [string]$payload.tool_input.script }
    }
    if ([string]::IsNullOrWhiteSpace($command)) { exit 0 } # no command field -> allow

    # Normalize: collapse whitespace, lower-case for matching.
    $norm = ($command -replace '\s+', ' ').Trim().ToLowerInvariant()

    # Dangerous patterns (regex, already lower-cased input). Keep tight to avoid false positives.
    $patterns = @(
        @{ rx = '\bsupabase\b\s+db\s+push\b';                 why = 'supabase db push (production DB)' },
        @{ rx = '\bsupabase\b\s+db\s+reset\b';                why = 'supabase db reset (destructive)' },
        @{ rx = '\bsupabase\b\s+migration\s+up\b';            why = 'supabase migration up (live apply)' },
        @{ rx = '\bsupabase\b\s+functions\s+deploy\b';        why = 'supabase functions deploy (prod Edge)' },
        @{ rx = '\bvercel\b.*(--prod\b|-p\s+production\b)';   why = 'vercel production deploy' },
        @{ rx = 'deploy_db\s*=\s*true';                       why = 'deploy_db=true (CI DB deploy)' },
        @{ rx = '\bdrop\s+(table|schema|database)\b';         why = 'destructive DROP TABLE/SCHEMA/DATABASE' },
        @{ rx = '\btruncate\b';                               why = 'destructive TRUNCATE' }
    )

    foreach ($p in $patterns) {
        if ($norm -match $p.rx) {
            $reason = "Blocked by VinPoker safety hook: $($p.why). This requires an owner-approved controlled runbook with the exact owner phrase. Do not add an allowlist exception to bypass this."
            $out = @{
                hookSpecificOutput = @{
                    hookEventName            = 'PreToolUse'
                    permissionDecision       = 'deny'
                    permissionDecisionReason = $reason
                }
            }
            $out | ConvertTo-Json -Compress -Depth 5
            exit 0
        }
    }

    exit 0   # no dangerous pattern -> allow
}
catch {
    # Fail-open: never block the workflow on a hook error.
    exit 0
}
