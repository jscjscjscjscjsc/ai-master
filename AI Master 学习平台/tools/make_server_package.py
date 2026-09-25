"""打一个「传到服务器上双击就能上线」的部署包（比赛演示用）。

和 tools/make_release.py 的区别
------------------------------
make_release.py 打的是**发给学生自己电脑用**的包：不含用户的 data/、不含 .env，
每个人在自己机器上填自己的模型密钥。这个脚本打的是**放到公网服务器对外演示**的包，
所以：

  · 带上服务器模式的 .env 模板（含平台模型 Key、演示账号、并行线程数）；
  · 带上随包 Python 与全部 wheel（服务器上不需要装任何东西）；
  · 额外塞进「一键上线.bat」（设环境变量 + 开防火墙 + 起服务）与「上线前自检.bat」；
  · **绝不带** data/users.json（真实账号）、data/.secret_key、logs/。

用法
----
    python tools/make_server_package.py
    python tools/make_server_package.py --with-userdata   # 连现有账号一起搬（迁移场景）
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / 'dist'
WHEELS = ROOT / 'vendor' / 'wheels'
RUNTIME_ZIP = ROOT / 'runtime' / 'python-embed.zip'

# 不打进包：运行环境、开发产物、用户数据
EXCLUDE_DIRS = {
    '.git', '__pycache__', 'logs', 'dist', 'runtime', 'vendor',
    '.build-ppt', '.build-video', '.video-10min', '_bak_20260923',
    'data/training', 'data/coach', 'data/audio_cache',
    'tools/__pycache__', 'tools/render',
}
EXCLUDE_FILES = {
    '.env',                       # 含真实密钥，改成 .env.server 模板进包
    'data/users.json',            # 真实账号
    'data/.secret_key',           # 会话密钥（每台机器应各自生成）
    'data/.setup_skipped',
    '_dump.json', '_sync_check.txt', '_cl.py', '_p1.py', '_p2.py', '_p3.py',
    '_p4.py', '_p5.py', '_p6.py', '_q1.py', '验收报告.md',
    'start_server.bat',           # 由本脚本重新生成
}
KEEP_SUFFIX = {'.py', '.json', '.txt', '.md', '.js', '.mjs', '.css', '.html',
               '.png', '.jpg', '.jpeg', '.svg', '.mp3', '.ico', '.woff',
               '.woff2', '.ttf', '.bat', '.sh', '.toml', '.cfg', '.example'}

SERVER_BATS = ('一键上线.bat', '上线前自检.bat')
ALLOWED_ROOT_BATS = {'0-启动AIMaster.bat'} | set(SERVER_BATS)
SERVER_DOCS = ('大模型添加说明书和教程.md', '本地与云服务器部署教程.md')

# 平台模型配置：从本机 .env 读出来写进模板，这样评委打开就能用、不必自己配 Key。
# 这是"比赛演示"场景的刻意选择 —— 发给学生的包不会带这个。
_AI_KEYS = ('STARLAB_AI_BASE_URL', 'STARLAB_AI_MODEL', 'ARK_API_KEY',
            'STARLAB_AI_FALLBACK_MODELS', 'STARLAB_AI_THINKING')


def say(text):
    print(text, flush=True)


def read_local_env():
    values = {}
    env_file = ROOT / '.env'
    if env_file.exists():
        for raw in env_file.read_text(encoding='utf-8').splitlines():
            line = raw.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                values[key.strip()] = value.strip()
    return values


def server_env_text():
    """服务器用的 .env：平台模型 + 服务器模式 + 演示账号。"""
    local = read_local_env()
    lines = [
        '# AI Master 服务器配置（由 tools/make_server_package.py 生成）',
        '#',
        '# 平台模型：评委打开就能用，不需要自己配 Key。',
        '# 注意这份文件含真实密钥，别把服务器包分享给外部。',
    ]
    for key in _AI_KEYS:
        value = local.get(key, '')
        if key == 'STARLAB_AI_THINKING' and not value:
            value = 'disabled'
        lines.append(f'{key}={value}')
    lines += [
        '',
        '# ── 服务器模式（多人公网）────────────────────────────',
        '# 打开后换成多线程 Web 服务器：一个人等 AI 回答时不会把别人挡在门外。',
        'STARLAB_SERVER_MODE=1',
        'STARLAB_THREADS=16',
        '',
        '# ── 演示账号（比赛/评审场景）──────────────────────────',
        '# 档案里预置了一份学习痕迹（修为、星器、错题、知识图谱分档），',
        '# 评委不必注册就能看到完整效果；他的一切操作只存在内存里、不写盘，',
        '# 重启即还原，不会污染真实数据。',
        'STARLAB_DEMO_USER=reviewer',
        'STARLAB_DEMO_PASSWORD=aimaster2026',
        '',
        '# 演示账号的口令是公开的，所以把它写在这里就好；',
        '# 想关掉演示账号，把上面两行的值清空再重启。',
    ]
    return '\n'.join(lines) + '\n'


ONECLICK_BAT = r'''@echo off
chcp 936 >nul
cd /d "%~dp0"
title AI Master 一键上线

echo.
echo   ============================================================
echo      AI Master 星辰学习系统   服务器版一键上线
echo   ============================================================
echo.

if not exist "app.py" (
  echo   [错误] 本脚本必须和 app.py 放在同一个文件夹里。
  echo          请确认解压的是完整的服务器版压缩包。
  echo.
  pause
  exit /b 1
)

REM ── 1. 配置文件 ───────────────────────────────────────────
if not exist ".env" (
  echo   [1/5] 生成服务器配置 .env ...
  if exist ".env.server" ( copy /y ".env.server" ".env" >nul ) else (
    > ".env" echo STARLAB_SERVER_MODE=1
    >> ".env" echo STARLAB_THREADS=16
  )
) else (
  echo   [1/5] 已有 .env，沿用现有配置。
)

set "PORT=5178"

REM ── 2. 放行防火墙 ─────────────────────────────────────────
echo   [2/5] 放行 Windows 防火墙端口 %PORT% ...
netsh advfirewall firewall show rule name="AIMaster %PORT%" >nul 2>nul
if errorlevel 1 (
  netsh advfirewall firewall add rule name="AIMaster %PORT%" dir=in action=allow protocol=TCP localport=%PORT% >nul 2>nul
  if errorlevel 1 (
    echo         [!] 需要管理员权限才能改防火墙。请右键本文件选「以管理员身份运行」，
    echo             否则外面可能连不上（浏览器一直转圈）。
  ) else (
    echo         已放行 TCP %PORT%
  )
) else (
  echo         规则已存在，跳过。
)

REM ── 3. 准备运行环境 ───────────────────────────────────────
set "PY="
if exist "runtime\python\python.exe" set "PY=%~dp0runtime\python\python.exe"
if defined PY goto env_ready

if exist "runtime\python-embed.zip" (
  echo   [3/5] 解压随包 Python（只需一次）...
  if not exist "runtime\python" mkdir "runtime\python"
  tar -xf "runtime\python-embed.zip" -C "runtime\python" 2>nul
  if not exist "runtime\python\python.exe" powershell -NoProfile -Command "Expand-Archive -LiteralPath 'runtime\python-embed.zip' -DestinationPath 'runtime\python' -Force" >nul 2>nul
)
if exist "runtime\python\python.exe" set "PY=%~dp0runtime\python\python.exe"
if defined PY goto env_ready

echo   [3/5] 没有随包 Python，改用系统 Python ...
py -3 "tools\bootstrap_runtime.py"
if not errorlevel 1 goto use_venv
python "tools\bootstrap_runtime.py"
if not errorlevel 1 goto use_venv
echo   [错误] 没有可用的 Python，请使用完整的服务器版压缩包。
pause
exit /b 1

:use_venv
if exist "runtime\venv\Scripts\python.exe" set "PY=%~dp0runtime\venv\Scripts\python.exe"
if not defined PY ( echo   [错误] 运行环境没有准备好。 & pause & exit /b 1 )
goto env_ready

:env_ready
echo   [3/5] 安装依赖（离线，不需要网络）...
"%PY%" "tools\bootstrap_runtime.py"
if errorlevel 1 ( echo. & echo   [错误] 依赖安装失败，请截图反馈。 & pause & exit /b 1 )

REM ── 4. 显示地址 ───────────────────────────────────────────
echo   [4/5] 本机地址：
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=1" %%b in ("%%a") do echo         内网：%%b
)
echo         公网地址见云控制台的「公网 IP」
echo         完整地址形如： http://公网IP:%PORT%
echo.
echo         提示：云控制台的「安全组」也要放行 TCP %PORT%，否则外面连不上。

REM ── 5. 启动 ───────────────────────────────────────────────
echo   [5/5] 启动服务 ...（关闭本窗口即停止服务）
echo.
echo   ------------------------------------------------------------
echo     打开后先看开场 CG；演示账号 reviewer / aimaster2026
echo   ------------------------------------------------------------
echo.

set STARLAB_OPEN_BROWSER=0
"%PY%" app.py
set "EXITCODE=%errorlevel%"

echo.
if not "%EXITCODE%"=="0" (
  echo   服务异常退出（代码 %EXITCODE%）。常见原因：
  echo     · %PORT% 端口被占用；· 杀毒软件拦截 Python
  echo   上面的报错信息可以直接截图。
) else (
  echo   服务已停止。
)
echo.
pause
'''

PRECHECK_BAT = r'''@echo off
chcp 936 >nul
cd /d "%~dp0"
title AI Master 上线前自检

set "PY="
if exist "runtime\python\python.exe" set "PY=%~dp0runtime\python\python.exe"
if not defined PY if exist "runtime\venv\Scripts\python.exe" set "PY=%~dp0runtime\venv\Scripts\python.exe"
if not defined PY (
  echo   找不到 Python 运行环境，请先双击「一键上线.bat」完成环境准备。
  pause
  exit /b 1
)
"%PY%" "tools\preflight_check.py"
pause
'''

SERVER_README = """AI Master 星辰学习系统 · 服务器版（比赛演示）
================================================

【怎么上线】
  1. 把整个文件夹解压到服务器（路径尽量短、不带中文空格）
  2. 双击「一键上线.bat」
  3. 看到「已启动」后，浏览器打开：  http://公网IP:5178

【云控制台还要做一步】
  「安全组」加入方向规则：协议 TCP，端口 5178，授权对象 0.0.0.0/0
  只开 Windows 防火墙不够 —— 表现是浏览器一直转圈直到超时。

【评委怎么体验】
  直接打开 http://公网IP:5178 即可，不需要注册、也不需要填任何 API Key：
  · 平台已经内置模型配置，打开就能问 AI；
  · 想看到"有学习痕迹"的完整效果（修为/星器/知识图谱分档/该补哪里），
    用演示账号登录：reviewer / aimaster2026
    这个账号的档案是预置的，他的一切操作只在内存里、不写盘，重启即还原。

【数据在哪】
  data/users.json      注册账号
  data/training/       每个学生的学习档案
  备份：整个 data 目录拷走即可。

【怎么停止】
  关闭那个命令行窗口。
"""


def should_keep(path: Path, with_userdata: bool) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    if rel in EXCLUDE_FILES and not (with_userdata and rel == 'data/users.json'):
        return False
    for blocked in EXCLUDE_DIRS:
        if rel == blocked or rel.startswith(blocked + '/'):
            return False
    if any(part == '__pycache__' for part in path.parts):
        return False
    if path.name.startswith('.env.') and path.name not in ('.env.example',):
        return False
    if path.suffix.lower() not in KEEP_SUFFIX and path.name not in ALLOWED_ROOT_BATS:
        return False
    return True


def stage(stage_dir: Path, with_userdata: bool) -> int:
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir(parents=True)
    count = 0
    for path in sorted(ROOT.rglob('*')):
        if path.is_dir() or not should_keep(path, with_userdata):
            continue
        target = stage_dir / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        count += 1

    (stage_dir / 'runtime').mkdir(exist_ok=True)
    if RUNTIME_ZIP.exists():
        shutil.copy2(RUNTIME_ZIP, stage_dir / 'runtime' / 'python-embed.zip')
    shutil.copytree(WHEELS, stage_dir / 'vendor' / 'wheels', dirs_exist_ok=True)

    (stage_dir / '.env.server').write_text(server_env_text(), encoding='utf-8')
    (stage_dir / '一键上线.bat').write_text(ONECLICK_BAT, encoding='gbk', errors='replace')
    (stage_dir / '上线前自检.bat').write_text(PRECHECK_BAT, encoding='gbk', errors='replace')
    (stage_dir / '使用说明.txt').write_text(SERVER_README, encoding='utf-8')
    (stage_dir / 'data').mkdir(exist_ok=True)
    return count


def make_zip(stage_dir: Path, archive: Path):
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.exists():
        archive.unlink()
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(stage_dir.rglob('*')):
            if path.is_file():
                zf.write(path, path.relative_to(stage_dir.parent))
    return archive


def main():
    parser = argparse.ArgumentParser(description='打 AI Master 服务器部署包')
    parser.add_argument('--with-userdata', action='store_true',
                        help='连现有账号一起打（把本机用户搬到服务器时用）')
    parser.add_argument('--no-ai', action='store_true',
                        help='不带平台模型配置（访客需自己填 Key）')
    args = parser.parse_args()

    say('[1/3] 收集文件')
    stamp = datetime.now().strftime('%Y%m%d')
    name = f'AIMaster-服务器版-{stamp}'
    stage_dir = OUT_DIR / name
    count = stage(stage_dir, with_userdata=args.with_userdata)
    say(f'  · {count} 个源文件 + 随包 Python + {len(list(WHEELS.glob("*.whl")))} 个 wheel')

    if args.no_ai:
        env_file = stage_dir / '.env.server'
        lines = [l for l in env_file.read_text(encoding='utf-8').splitlines()
                 if not l.startswith(('ARK_API_KEY=', 'STARLAB_AI_'))]
        env_file.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        say('  · 已按要求剔除平台模型配置')

    say('[2/3] 校验')
    problems = []
    for required in ('app.py', '一键上线.bat', '上线前自检.bat', '.env.server',
                     *SERVER_DOCS):
        if not (stage_dir / required).exists():
            problems.append(f'缺少 {required}')
    if not (stage_dir / 'runtime' / 'python-embed.zip').exists():
        problems.append('缺少随包 Python')
    if not (stage_dir / 'tools' / 'bootstrap_runtime.py').exists():
        problems.append('缺少 tools/bootstrap_runtime.py（启动脚本依赖它）')
    if (stage_dir / '.env').exists():
        problems.append('包内出现了 .env（真实密钥不应进包，只该有 .env.server 模板）')
    if (stage_dir / 'data' / '.secret_key').exists():
        problems.append('包内出现了 data/.secret_key（应由各台机器自行生成）')
    if not args.with_userdata and (stage_dir / 'data' / 'users.json').exists():
        problems.append('包内出现了 data/users.json（会泄露用户数据）')
    for seed in ('courses.json', 'question_bank.json'):
        if not (stage_dir / 'data' / seed).exists():
            problems.append(f'缺少 seed 数据 data/{seed}')
    bats = list(stage_dir.glob('*.bat'))
    if any(b.name not in ALLOWED_ROOT_BATS for b in bats):
        problems.append('根目录出现了不在白名单里的 bat')
    # 服务器模式与多线程服务器是"能不能多人用"的关键，包漏了就退化成单机
    if 'STARLAB_SERVER_MODE=1' not in (stage_dir / '.env.server').read_text(encoding='utf-8'):
        problems.append('.env.server 里没有 STARLAB_SERVER_MODE=1')
    if 'waitress' not in (stage_dir / 'requirements-bundle.txt').read_text(encoding='utf-8'):
        problems.append('requirements-bundle.txt 里没有 waitress（多人访问会退化成单线程）')
    if problems:
        for p in problems:
            say('  ✗ ' + p)
        raise SystemExit(1)
    say('  · 校验通过')

    say('[3/3] 打包')
    archive = make_zip(stage_dir, OUT_DIR / f'{name}.zip')
    size = archive.stat().st_size / 1024 / 1024
    say(f'  ✓ {archive}')
    say(f'  · 体积 {size:.1f} MB')
    say('')
    say('下一步：把 zip 上传到服务器，解压后双击「一键上线.bat」，')
    say('        并在云控制台安全组放行 TCP 5178。')


if __name__ == '__main__':
    main()
