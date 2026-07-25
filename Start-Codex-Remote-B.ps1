param(
    [switch]$Stop
)

$candidates = @(
    (Get-Command codex -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    "$env:LOCALAPPDATA\OpenAI\Codex\bin\a7c12ebff69fb123\codex.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if (-not $candidates) {
    throw "Codex CLI was not found. Install or update the Codex desktop app first."
}

$codex = $candidates[0]

if ($Stop) {
    & $codex remote-control stop
    exit $LASTEXITCODE
}

& $codex remote-control start
if ($LASTEXITCODE -ne 0) {
    throw "Could not start Codex remote control."
}

Write-Host "Remote control is running. Create this short-lived pairing code on computer B:"
& $codex remote-control pair
