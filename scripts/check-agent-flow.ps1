$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$errors = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Test-RepoPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$AllowGlob
    )

    $fullPath = Join-Path $repoRoot $Path
    if ($AllowGlob) {
        if (-not (Get-ChildItem -Path $fullPath -ErrorAction SilentlyContinue)) {
            $errors.Add("Missing required path pattern: $Path")
        }
    }
    elseif (-not (Test-Path -LiteralPath $fullPath)) {
        $errors.Add("Missing required path: $Path")
    }
}

$requiredPaths = @(
    "AGENTS.md",
    ".agent/current-status.md",
    ".agent/design-logs/INDEX.md",
    ".agent/design-logs/ARCHIVE-INDEX.md",
    "README.md",
    "docs/project-overview.md",
    "docs/architecture.md",
    "docs/architecture/ARCHITECTURE-NOTES.md",
    "docs/airtable-schema.md",
    "docs/workflow-ids.md",
    "docs/email-design-rules.md",
    "docs/ui-design-system.md",
    "docs/ui-design-system-full.md",
    "docs/common-mistakes.md",
    "docs/performance-benchmarks.md",
    "docs/meeting-with-natan-action-items.md",
    "docs/gws-cli.md",
    "SSOT_required_documents_from_Tally_input.md",
    "SSOT_CS_required_documents.md",
    "frontend/admin/react/README.md"
)

foreach ($path in $requiredPaths) {
    Test-RepoPath $path
}

Test-RepoPath "docs/architecture/*.mmd" -AllowGlob

$skillRoot = Join-Path $repoRoot ".agents/skills"
if (Test-Path -LiteralPath $skillRoot) {
    $skillDirs = Get-ChildItem -LiteralPath $skillRoot -Directory
    foreach ($dir in $skillDirs) {
        $skillFile = Join-Path $dir.FullName "SKILL.md"
        if (-not (Test-Path -LiteralPath $skillFile)) {
            $fileCount = @(Get-ChildItem -LiteralPath $dir.FullName -Recurse -Force -File).Count
            if ($fileCount -eq 0) {
                $warnings.Add("Empty repo skill placeholder is ignored by Codex: .agents/skills/$($dir.Name)")
            }
            else {
                $errors.Add("Non-empty repo skill directory lacks SKILL.md: .agents/skills/$($dir.Name)")
            }
        }
    }
}
else {
    $errors.Add("Missing repo skill directory: .agents/skills")
}

$codexPath = Join-Path $repoRoot "CODEX.md"
if (Test-Path -LiteralPath $codexPath) {
    $codexText = Get-Content -LiteralPath $codexPath -Raw
    $lineCount = ($codexText -split "`r?`n").Count
    if ($lineCount -gt 20) {
        $warnings.Add("CODEX.md is longer than 20 lines; keep Codex-facing rules in AGENTS.md.")
    }
    if ($codexText -match "## Core Principles|## Operating Mode|## Git Rules|## UI Rules") {
        $warnings.Add("CODEX.md appears to duplicate operating rules; keep it as a pointer.")
    }
}

$criticalPaths = @(
    "AGENTS.md",
    "CODEX.md",
    ".agents/skills/consolidate-memory/SKILL.md",
    ".agents/skills/monthly-insights/SKILL.md",
    "scripts/check-agent-flow.ps1",
    "docs/project-overview.md",
    "docs/architecture.md",
    "docs/airtable-schema.md",
    "docs/workflow-ids.md",
    "docs/email-design-rules.md",
    "docs/ui-design-system.md",
    "docs/ui-design-system-full.md"
)

$gitTracked = @{}
try {
    $tracked = git -C $repoRoot ls-files -- $criticalPaths 2>$null
    foreach ($path in $tracked) {
        $gitTracked[$path.Replace("\", "/")] = $true
    }
    foreach ($path in $criticalPaths) {
        $normalized = $path.Replace("\", "/")
        if ((Test-Path -LiteralPath (Join-Path $repoRoot $path)) -and -not $gitTracked.ContainsKey($normalized)) {
            $warnings.Add("Critical agent-flow file is untracked: $path")
        }
    }
}
catch {
    $warnings.Add("Could not inspect git tracking state: $($_.Exception.Message)")
}

if ($warnings.Count -gt 0) {
    Write-Host "Warnings:" -ForegroundColor Yellow
    foreach ($warning in $warnings) {
        Write-Host "  - $warning" -ForegroundColor Yellow
    }
}

if ($errors.Count -gt 0) {
    Write-Host "Errors:" -ForegroundColor Red
    foreach ($errorItem in $errors) {
        Write-Host "  - $errorItem" -ForegroundColor Red
    }
    exit 1
}

Write-Host "Agent flow check passed." -ForegroundColor Green
