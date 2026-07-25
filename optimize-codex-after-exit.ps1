$ErrorActionPreference = 'SilentlyContinue'
$codexHome = Join-Path $env:USERPROFILE '.codex'
$config = Join-Path $codexHome 'config.toml'
$cli = 'C:\Users\Administrator\AppData\Local\OpenAI\Codex\bin\a7c12ebff69fb123\codex.exe'
$log = Join-Path $codexHome 'optimization-result.txt'

# Wait until the desktop app releases its databases.
for ($i = 0; $i -lt 720; $i++) {
    $active = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -in @('codex', 'codex-code-mode-host', 'node_repl')
    }
    if (-not $active) { break }
    Start-Sleep -Seconds 5
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item -LiteralPath $config -Destination "$config.before-final-speed-$stamp" -Force

if (Test-Path -LiteralPath $cli) {
    & $cli plugin remove 'browser@openai-bundled' --json 2>&1 | Out-File -FilePath $log -Encoding utf8
    & $cli plugin remove 'visualize@openai-bundled' --json 2>&1 | Out-File -FilePath $log -Encoding utf8 -Append
}

Get-ChildItem -LiteralPath $codexHome -Filter 'logs_2.sqlite*' | Remove-Item -Force
Remove-Item -LiteralPath (Join-Path $codexHome '.tmp') -Recurse -Force

@'
model_provider = "my_codex"
model = "gpt-5.6-terra"
model_reasoning_effort = "low"
disable_response_storage = true

[model_providers.my_codex]
name = "my_codex"
base_url = "http://127.0.0.1:15721/v1"
wire_api = "responses"
requires_openai_auth = true

[mcp_servers]

[desktop]
followUpQueueMode = "queue"

[features]
js_repl = false

[windows]
sandbox = "elevated"

[projects.'c:\users\administrator\documents\new project']
trust_level = "trusted"

[plugins."browser@openai-bundled"]
enabled = false

[plugins."visualize@openai-bundled"]
enabled = false
'@ | Set-Content -LiteralPath $config -Encoding utf8

Set-ItemProperty -LiteralPath $config -Name IsReadOnly -Value $true
"Completed=$(Get-Date -Format o)" | Out-File -FilePath $log -Encoding utf8 -Append
