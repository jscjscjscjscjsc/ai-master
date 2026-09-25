"""打一个"解压即用"的 AI Master 分发包。

为什么这么打
------------
下载压缩包的学生里，失败最多的两步是"没装 Python"和"pip 装不上"
（校园网 / 公司网最容易被拦）。所以分发包里自带：

  · runtime/python-embed.zip   嵌入式 Python 3.12（约 11MB，不需要用户装）
  · vendor/wheels/*.whl        全部依赖的 wheel，离线安装
  · 0-启动AIMaster.bat         唯一入口，首次运行自动铺好环境

用户拿到压缩包只需要：解压 → 双击「0-启动AIMaster.bat」。

关于 wheel 的取舍
-----------------
开发目录里的 vendor/wheels 有 60 个包、约 54MB —— 那是打 PyMaster 时
顺手带过来的（pandas / matplotlib / fastapi / numpy ...），平台自己
一个都不用：requirements.txt 只有 flask 与 edge-tts 两项。
所以打包时**按 requirements-bundle.txt 精确裁剪**，只带真正会装的 22 个，
整包从 100MB 降到 50MB 出头。

用法
----
    python tools/make_release.py                 # 正式包
    python tools/make_release.py --with-docs     # 带上验收报告等开发文档
    python tools/make_release.py --tag v1.0      # 文件名加版本后缀
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / 'dist'
WHEELS = ROOT / 'vendor' / 'wheels'
RUNTIME_ZIP = ROOT / 'runtime' / 'python-embed.zip'
REQ_BUNDLE = ROOT / 'requirements-bundle.txt'
BAT_NAME = '0-启动AIMaster.bat'

# 不打进分发包：运行环境、开发工具链、产物与用户数据
EXCLUDE_DIRS = {
    '.git', '__pycache__', 'logs', 'dist', 'runtime', 'vendor',
    '.build-ppt', '.build-video', '.video-10min', '_bak_20260923',
    'data/training', 'data/coach', 'data/audio_cache',
    # tools 里只排除确定与运行无关的产物；不要整个排掉 ——
    # 启动脚本要调 tools/bootstrap_runtime.py，排掉它包就起不来了。
    'tools/__pycache__',
}
EXCLUDE_FILES = {
    # 用户数据与密钥：绝对不能进包
    '.env', 'data/users.json', 'data/.secret_key',
    # 开发过程的中间产物
    '_dump.json', '_sync_check.txt', '_cl.py', '_p1.py', '_p2.py', '_p3.py',
    '_p4.py', '_p5.py', '_p6.py', '_q1.py', '验收报告.md',
}
# 这些后缀之外的文件不进包（避免把日志、缓存、临时文件带上）
KEEP_SUFFIX = {'.py', '.json', '.txt', '.md', '.js', '.mjs', '.css', '.html',
               '.png', '.jpg', '.jpeg', '.svg', '.mp3', '.ico', '.woff',
               '.woff2', '.ttf', '.bat', '.sh', '.toml', '.cfg', '.example'}

# 模型配置说明文档：随包发给用户，放在根目录最显眼的位置
DOC_FILES = ['大模型添加说明书和教程.md', '本地与云服务器部署教程.md']

README = """AI Master 星辰学习系统 · 使用说明
======================================

【怎么启动】
  1. 把整个文件夹解压到任意目录（路径带中文、空格都没问题）
  2. 双击「0-启动AIMaster.bat」—— 就这一个启动脚本，认准它
  3. 首次启动会自动准备运行环境（约 1 分钟，不需要你安装 Python）
  4. 浏览器会自动打开 http://127.0.0.1:5178
     —— 没自动打开就手动访问这个地址

【第一次打开会看到什么】
  平台会让你配置大模型（填接口地址 + API Key）。
  · 想用 AI 功能：照着《大模型添加说明书和教程.md》做，默认按 DeepSeek 写好了，
    五分钟能配完；有「测试连接」按钮，填错会明确告诉你错在哪。
  · 暂时没有 Key：点页面上的「暂时不配置，先去看看课程」即可进入。
    课程、章节 CG、刷题、判题、星空修为、学习档案全都能用，
    只有星语智能体、AI 批改、星辰教练会提示"还没配置"。
    之后随时点右上角「模型配置」补上，补完立刻生效，不用重启。

【怎么停止】
  关闭那个黑色命令行窗口即可。

【常见问题】
  · 提示"没有找到 Python"
      这个包是完整版，正常不会出现。若出现，说明解压不完整，
      请重新解压（务必"解压全部"，不要在压缩包里直接双击运行）。
  · 提示端口 5178 被占用
      关掉其它 AI Master 窗口再启动；脚本会自动清理残留进程。
  · 杀毒软件报毒 / 拦截
      Python 启动本地服务的行为常被误判，把本文件夹加入白名单即可。
  · 浏览器打开是空白 / 打不开
      先确认那个黑色窗口还开着；再手动访问 http://127.0.0.1:5178

【数据在哪】
  账号与进度都在 data/ 目录（users.json、training/、coach/）。
  备份直接拷 data 目录即可；换电脑把 data 拷过去就能接着学。

【想在服务器上给多人用】
  见《本地与云服务器部署教程.md》。
"""


def say(text):
    print(text, flush=True)


def wanted_wheels():
    """按 requirements-bundle.txt 挑出真正要装的 wheel（大小写与下划线不敏感）。"""
    names = set()
    if REQ_BUNDLE.exists():
        for line in REQ_BUNDLE.read_text(encoding='utf-8').splitlines():
            if '==' in line and not line.startswith('#'):
                names.add(line.split('==')[0].strip().lower().replace('-', '_'))
    names.add('pip')                      # 嵌入式 Python 靠它装库，必须带
    picked = []
    for whl in sorted(WHEELS.glob('*.whl')):
        if whl.name.split('-')[0].lower().replace('-', '_') in names:
            picked.append(whl)
    return picked


def should_keep(path: Path) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    if rel in EXCLUDE_FILES:
        return False
    for blocked in EXCLUDE_DIRS:
        if rel == blocked or rel.startswith(blocked + '/'):
            return False
    if any(part == '__pycache__' for part in path.parts):
        return False
    # 密钥备份一律不进包
    if path.name.startswith('.env.') and path.name != '.env.example':
        return False
    if path.suffix.lower() not in KEEP_SUFFIX and path.name != BAT_NAME:
        return False
    return True


def stage(stage_dir: Path, with_docs=False):
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir(parents=True)
    count = 0
    for path in sorted(ROOT.rglob('*')):
        if path.is_dir() or not should_keep(path):
            continue
        target = stage_dir / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        count += 1

    # 随包 Python 与离线依赖
    (stage_dir / 'runtime').mkdir(exist_ok=True)
    if RUNTIME_ZIP.exists():
        shutil.copy2(RUNTIME_ZIP, stage_dir / 'runtime' / 'python-embed.zip')
    else:
        say('  ! 缺少 runtime/python-embed.zip，包会退化成"需要系统 Python"')
    picked = wanted_wheels()
    dest = stage_dir / 'vendor' / 'wheels'
    dest.mkdir(parents=True, exist_ok=True)
    for whl in picked:
        shutil.copy2(whl, dest / whl.name)

    # 只留一个启动入口
    bats = sorted(stage_dir.glob('*.bat'))
    for bat in bats:
        if bat.name != BAT_NAME:
            bat.unlink()
            say(f'  · 移除多余启动脚本：{bat.name}')

    (stage_dir / '使用说明.txt').write_text(README, encoding='utf-8')
    for doc in DOC_FILES:
        src = ROOT / doc
        if src.exists():
            shutil.copy2(src, stage_dir / doc)
        else:
            say(f'  ! 缺少文档 {doc}（正式发包前请先补齐）')
    (stage_dir / 'data').mkdir(exist_ok=True)
    return count, picked


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
    parser = argparse.ArgumentParser(description='打 AI Master 分发包')
    parser.add_argument('--tag', default='', help='版本后缀，例如 v1.0')
    parser.add_argument('--no-python', action='store_true', help='不打进随包 Python')
    parser.add_argument('--with-docs', action='store_true', help='保留验收报告等开发文档')
    args = parser.parse_args()

    if args.with_docs:
        EXCLUDE_FILES.discard('验收报告.md')

    say('[1/4] 收集文件')
    stage_dir = OUT_DIR / 'AIMaster'
    count, picked = stage(stage_dir, with_docs=args.with_docs)
    say(f'  · {count} 个源文件，{len(picked)} 个 wheel')

    say('[2/4] 校验完整性')
    problems = []
    if not (stage_dir / 'app.py').exists():
        problems.append('缺少 app.py')
    if not (stage_dir / BAT_NAME).exists():
        problems.append(f'缺少启动脚本 {BAT_NAME}')
    if not args.no_python and not (stage_dir / 'runtime' / 'python-embed.zip').exists():
        problems.append('缺少随包 Python')
    # 启动脚本要调这个自举脚本；漏了它双击就报"找不到文件"，
    # 而脚本本身是好的 —— 这种"包少了个文件"的错最难让学生描述清楚。
    if not (stage_dir / 'tools' / 'bootstrap_runtime.py').exists():
        problems.append('缺少 tools/bootstrap_runtime.py（启动脚本依赖它）')
    if not (stage_dir / 'requirements-bundle.txt').exists():
        problems.append('缺少 requirements-bundle.txt（离线安装清单）')
    for seed in ('courses.json', 'question_bank.json'):
        if not (stage_dir / 'data' / seed).exists():
            problems.append(f'缺少 seed 数据 data/{seed}')
    if (stage_dir / '.env').exists():
        problems.append('包内出现了 .env（会泄露密钥）')
    if (stage_dir / 'data' / 'users.json').exists():
        problems.append('包内出现了 data/users.json（会泄露用户数据）')
    bats = list(stage_dir.glob('*.bat'))
    if len(bats) != 1:
        problems.append(f'启动脚本不是唯一一个，找到 {len(bats)} 个')
    if problems:
        for item in problems:
            say('  ✗ ' + item)
        raise SystemExit(1)
    say('  · 校验通过（唯一入口 / 自带 Python / 依赖齐全 / 无密钥 / seed 数据齐全）')

    say('[3/4] 打包')
    name = 'AIMaster_星辰学习系统'
    if args.tag:
        name += '_' + args.tag
    archive = make_zip(stage_dir, OUT_DIR / f'{name}.zip')

    say('[4/4] 完成')
    size = archive.stat().st_size / 1024 / 1024
    raw = sum(f.stat().st_size for f in stage_dir.rglob('*') if f.is_file()) / 1024 / 1024
    say(f'  → {archive}')
    say(f'  → 解压后 {raw:.1f} MB，压缩包 {size:.1f} MB')
    say(f'  用户拿到后：解压 → 双击「{BAT_NAME}」')


if __name__ == '__main__':
    main()
