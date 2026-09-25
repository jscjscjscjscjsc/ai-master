"""生成给服务器执行的 PowerShell 部署脚本（AI Master 服务器版）。

为什么单独写这个：服务器上没有 git、也没有 Python，但能访问 GitHub 与
python.org。所以走"服务器自己下载"这条路 —— 下代码、下随包 Python、
装依赖、起服务，全部在服务器本地完成。

用法：python tools/gen_deploy_script.py > deploy.ps1
     （或直接 import 本模块取 build() 的返回值）
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read_local_env():
    values = {}
    env_file = ROOT / '.env'
    if env_file.exists():
        for raw in env_file.read_text(encoding='utf-8').splitlines():
            line = raw.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                values[k.strip()] = v.strip()
    return values


def build(root=r'C:\AIMaster', port=5178, demo_user='reviewer',
          demo_password='aimaster2026'):
    """生成部署脚本。root 是服务器上的安装目录。"""
    env = read_local_env()
    base = env.get('STARLAB_AI_BASE_URL', '')
    model = env.get('STARLAB_AI_MODEL', '')
    key = env.get('ARK_API_KEY', '')

    return f'''$ErrorActionPreference='Continue'
$ProgressPreference='SilentlyContinue'
$root='{root}'
$port={port}
New-Item -ItemType Directory -Force -Path $root | Out-Null
Set-Location $root

Write-Output '=== STEP1: PYTHON ==='
if (-not (Test-Path "$root\\runtime\\python\\python.exe")) {{
  try {{
    Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile "$root\\py.zip" -UseBasicParsing -TimeoutSec 300
    New-Item -ItemType Directory -Force -Path "$root\\runtime\\python" | Out-Null
    Expand-Archive -Path "$root\\py.zip" -DestinationPath "$root\\runtime\\python" -Force
    Write-Output 'PY_DOWNLOADED'
  }} catch {{ Write-Output ('PY_ERR ' + $_.Exception.Message.Substring(0,[Math]::Min(90,$_.Exception.Message.Length))) }}
}} else {{ Write-Output 'PY_EXISTS' }}
Write-Output ('PY_OK=' + (Test-Path "$root\\runtime\\python\\python.exe"))

Write-Output '=== STEP2: CODE ==='
if (-not (Test-Path "$root\\app.py")) {{
  try {{
    Invoke-WebRequest -Uri 'https://codeload.github.com/jscjscjscjscjsc/ai-master/zip/refs/heads/main' -OutFile "$root\\repo.zip" -UseBasicParsing -TimeoutSec 600
    Expand-Archive -Path "$root\\repo.zip" -DestinationPath "$root\\extract" -Force
    $src = (Get-ChildItem "$root\\extract" -Directory | Select-Object -First 1).FullName
    # 仓库里代码在 "AI Master 学习平台/" 子目录下
    $inner = Join-Path $src 'AI Master 学习平台'
    if (Test-Path (Join-Path $inner 'app.py')) {{ Copy-Item -Path (Join-Path $inner '*') -Destination $root -Recurse -Force }}
    else {{ Copy-Item -Path (Join-Path $src '*') -Destination $root -Recurse -Force }}
    Write-Output 'CODE_COPIED'
  }} catch {{ Write-Output ('CODE_ERR ' + $_.Exception.Message.Substring(0,[Math]::Min(90,$_.Exception.Message.Length))) }}
}} else {{ Write-Output 'CODE_EXISTS' }}
Write-Output ('CODE_OK=' + (Test-Path "$root\\app.py"))

Write-Output '=== STEP3: PTH FIX ==='
# 嵌入式 Python 的 ._pth 会让它忽略脚本所在目录，不解压时 import 不到
# 同目录的模块（coach_engine 等）。必须把项目根显式写进去。
$pth = Get-ChildItem "$root\\runtime\\python\\python*._pth" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pth) {{
  @('python312.zip', '.', $root, '..\\..', 'import site') | Set-Content -Path $pth.FullName -Encoding ASCII
  Write-Output ('PTH_FIXED=' + $pth.Name)
}}

Write-Output '=== STEP4: DEPS ==='
$py = "$root\\runtime\\python\\python.exe"
if (-not (Test-Path "$root\\get-pip.py")) {{
  Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile "$root\\get-pip.py" -UseBasicParsing -TimeoutSec 300
}}
& $py "$root\\get-pip.py" -i https://pypi.tuna.tsinghua.edu.cn/simple --no-warn-script-location 2>&1 | Select-Object -Last 2
& $py -m pip install flask waitress edge-tts -i https://pypi.tuna.tsinghua.edu.cn/simple --no-warn-script-location 2>&1 | Select-Object -Last 3
& $py -c "import flask, waitress, edge_tts; print('DEPS_OK')"

Write-Output '=== STEP5: ENV ==='
$env_lines = @(
  'STARLAB_AI_BASE_URL={base}'
  'STARLAB_AI_MODEL={model}'
  'ARK_API_KEY={key}'
  'STARLAB_AI_THINKING=disabled'
  '# 服务器模式：多线程，多人同时访问不互相卡'
  'STARLAB_SERVER_MODE=1'
  'STARLAB_THREADS=16'
  '# 演示账号：档案带学习痕迹，评委不必注册就能看到完整效果'
  'STARLAB_DEMO_USER={demo_user}'
  'STARLAB_DEMO_PASSWORD={demo_password}'
)
Set-Content -Path "$root\\.env" -Value $env_lines -Encoding UTF8
Write-Output 'ENV_WRITTEN'

Write-Output '=== STEP6: FIREWALL ==='
netsh advfirewall firewall delete rule name="AIMaster $port" 2>&1 | Out-Null
netsh advfirewall firewall add rule name="AIMaster $port" dir=in action=allow protocol=TCP localport=$port 2>&1 | Out-Null
Write-Output 'FIREWALL_DONE'

Write-Output '=== STEP7: START ==='
Get-Process python -ErrorAction SilentlyContinue | Where-Object {{ $_.Path -like "$root*" }} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$p = Start-Process -FilePath $py -ArgumentList 'app.py' -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput "$root\\server.log" -RedirectStandardError "$root\\server.err"
Write-Output ('PID=' + $p.Id)
Start-Sleep -Seconds 25
Write-Output '=== LISTEN ==='
netstat -ano | findstr ":$port" | findstr LISTEN
Write-Output '=== LOG ==='
if (Test-Path "$root\\server.log") {{ Get-Content "$root\\server.log" -Tail 12 }}
Write-Output '=== ERR ==='
if (Test-Path "$root\\server.err") {{ Get-Content "$root\\server.err" -Tail 12 }}
Write-Output '=== DONE ==='
'''


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    print(build())
