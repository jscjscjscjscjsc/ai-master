"""上线前自检：把"到服务器上才发现"的问题尽量提前暴露出来。

每一条都是实际会踩的坑，不是走形式的检查：
  · 安全组/防火墙没开 → 外面连不上，但本机自测永远是通的，最容易误判"部署成功"；
  · .env 里没有平台模型 → 评委打开发现 AI 用不了，演示效果直接没了；
  · 服务器模式没开 → 多人同时访问会互相卡（单线程）；
  · 端口被旧进程占着 → 两个版本同时监听，你看到的是旧内容；
  · data 目录不可写 → 注册时 500，报错还指不到原因。
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

OK, WARN, BAD = '√', '!', 'x'
problems = []
PORT = int(os.environ.get('PORT') or 5178)


def item(level, text, hint=''):
    mark = {OK: '[√]', WARN: '[!]', BAD: '[x]'}[level]
    print(f'  {mark} {text}')
    if hint:
        print(f'        → {hint}')
    if level == BAD:
        problems.append(text)


def check_files():
    print('\n【文件完整性】')
    required = ['app.py', 'coach_engine.py', 'star_engine.py', 'starlab_engine.py',
                'learning_memory.py', 'roadmap.py', 'demo_mode.py', 'ark_client.py',
                'templates/dashboard.html', 'templates/chapter.html',
                'templates/entry_cg.html', 'templates/progress.html',
                'static/css/core.css', 'static/js/progress.js', '一键上线.bat']
    missing = [f for f in required if not (ROOT / f).exists()]
    if missing:
        item(BAD, f'缺少关键文件：{", ".join(missing)}', '请用完整的服务器版压缩包')
    else:
        item(OK, f'关键文件齐全（{len(required)} 项）')

    for name in ('courses.json', 'question_bank.json'):
        p = ROOT / 'data' / name
        if not p.exists():
            item(BAD, f'缺少 data/{name}')
            continue
        try:
            data = json.loads(p.read_text(encoding='utf-8'))
            n = len(data) if isinstance(data, (list, dict)) else 0
            item(OK, f'data/{name} 可读（{n} 项）')
        except ValueError as exc:
            item(BAD, f'data/{name} 不是合法 JSON：{exc}')


def check_env():
    print('\n【平台配置】')
    env_file = ROOT / '.env'
    values = {}
    if env_file.exists():
        for raw in env_file.read_text(encoding='utf-8').splitlines():
            line = raw.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                values[k.strip()] = v.strip()
    else:
        item(WARN, '还没有 .env（双击「一键上线.bat」会自动生成）')

    merged = {**values, **{k: v for k, v in os.environ.items()
                           if k.startswith(('STARLAB_', 'ARK_'))}}

    base = merged.get('STARLAB_AI_BASE_URL', '')
    model = merged.get('STARLAB_AI_MODEL', '')
    key = merged.get('ARK_API_KEY', '')
    if base and model and key:
        item(OK, f'平台模型已配置（{model}）',
             '评委打开就能用 AI，不需要自己填 Key')
    else:
        item(WARN, '平台模型没配全',
             '评委打开会用不了 AI。请填 STARLAB_AI_BASE_URL / STARLAB_AI_MODEL / ARK_API_KEY')

    if merged.get('STARLAB_SERVER_MODE', '').lower() in ('1', 'true', 'yes', 'on'):
        item(OK, '服务器模式已开启（多线程，多人同时访问不互相卡）')
    else:
        item(WARN, '还没开服务器模式',
             '在 .env 里加 STARLAB_SERVER_MODE=1 —— 否则一个人等 AI 回答时会把别人挡在门外')

    demo_user = merged.get('STARLAB_DEMO_USER', '')
    if demo_user:
        demo_pwd = merged.get('STARLAB_DEMO_PASSWORD', '')
        item(OK, f'演示账号已开启（{demo_user}）',
             '评委不必注册就能看到完整的学习档案'
             + (f'，口令 {demo_pwd}' if demo_pwd else '（口令用的是默认值）'))
    else:
        item(WARN, '没有演示账号',
             '评委需要自己注册才能看到进度/图谱类功能。设 STARLAB_DEMO_USER 可开一个')


def check_runtime():
    print('\n【运行环境】')
    # 关键：要检查**实际会用来跑服务的那套 Python**。
    # 服务器上服务是随包 Python 启动的（runtime\python\python.exe），
    # 而自检脚本可能是被系统 Python 跑起来的 —— 只 import 本进程的话，
    # 会报"缺少 waitress"但随包环境里其实装着（或反过来），白折腾一轮。
    # 所以这里显式去探测随包解释器。
    bundled = ROOT / 'runtime' / 'python' / 'python.exe'
    targets = []
    if bundled.exists():
        targets.append(('随包 Python', [str(bundled)]))
    targets.append((f'当前 Python {sys.version.split()[0]}', [sys.executable]))

    probe = (
        "import importlib\n"
        "for m in ('flask', 'waitress', 'edge_tts'):\n"
        "    try:\n"
        "        importlib.import_module(m)\n"
        "        print(m + '=ok')\n"
        "    except Exception:\n"
        "        print(m + '=missing')\n"
    )
    labels = {'flask': 'Flask', 'waitress': 'waitress（多线程服务器）',
              'edge_tts': 'edge-tts（语音合成）'}
    import subprocess
    for name, cmd in targets:
        try:
            out = subprocess.run(cmd + ['-c', probe], capture_output=True,
                                 text=True, timeout=60)
            result = dict(line.split('=', 1) for line in (out.stdout or '').splitlines()
                          if '=' in line)
        except Exception as exc:
            item(WARN, f'{name} 探测失败：{exc}')
            continue
        if not result:
            item(WARN, f'{name} 无法运行')
            continue
        missing = [labels[m] for m, v in result.items() if v != 'ok']
        if missing:
            lvl = BAD if 'Flask' in missing else WARN
            item(lvl, f'{name} 里缺少：{"、".join(missing)}',
                 '双击「一键上线.bat」会自动安装依赖（离线）')
        else:
            item(OK, f'{name}：Flask / waitress / edge-tts 齐全')


def check_demo_data():
    print('\n【演示档案】')
    if not (os.environ.get('STARLAB_DEMO_USER')
            or (ROOT / '.env').exists()):
        item(WARN, '无演示账号，跳过检查')
        return
    try:
        os.environ.setdefault('STARLAB_DEMO_USER', 'reviewer')
        os.environ.setdefault('STARLAB_DATA_DIR', str(ROOT / 'data'))
        import demo_mode
        state = demo_mode._seed_state()
    except Exception as exc:
        item(BAD, f'演示档案无法生成：{exc}')
        return
    mem = state.get('learning_memory') or {}
    if not mem:
        item(BAD, '演示档案里没有学习记忆',
             '评委打开学习档案会看到图谱全灰 —— 恰好看不出这个功能的价值')
        return
    try:
        import learning_memory as lm
        statuses = {}
        for row in mem.values():
            st = lm.mastery(row)['status']
            statuses[st] = statuses.get(st, 0) + 1
        if len(statuses) >= 2:
            item(OK, f'演示档案有学习痕迹：{statuses}',
                 '图谱会呈现绿/黄/红三档，能看出这个功能在做什么')
        else:
            item(WARN, f'演示档案的掌握度只有一种状态：{statuses}',
                 '图谱看起来会像一片同色，建议让种子数据有强弱区分')
    except Exception as exc:
        item(WARN, f'无法评估演示档案：{exc}')

    # 种子引用的题目必须真实存在：引用不存在的题会让修为推算 500
    try:
        import json as _json
        import re
        bank = _json.loads((ROOT / 'data' / 'question_bank.json').read_text(encoding='utf-8'))
        items = bank if isinstance(bank, list) else (bank.get('questions') or [])
        real = {str(i.get('id')) for i in items if isinstance(i, dict)}
        src = (ROOT / 'demo_mode.py').read_text(encoding='utf-8')
        used = set(re.findall(r"\('([a-zA-Z0-9_\-]+)',\s*\d+,", src))
        missing = sorted(used - real)
        if missing:
            item(BAD, f'演示种子引用了题库里不存在的题：{missing[:5]}',
                 '会让"按作答记录推导修为"抛异常、学习档案页 500')
        else:
            item(OK, f'演示种子的 {len(used)} 个题目 id 都在题库里')
    except Exception as exc:
        item(WARN, f'题目 id 核对跳过：{exc}')


def check_data_dir():
    print('\n【数据目录】')
    data_dir = Path(os.environ.get('STARLAB_DATA_DIR') or (ROOT / 'data'))
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        probe = data_dir / '.write_test'
        probe.write_text('ok', encoding='utf-8')
        probe.unlink()
        item(OK, f'{data_dir} 可写')
    except OSError as exc:
        item(BAD, f'{data_dir} 不可写：{exc}', '学生注册会直接报 500')
        return
    users = data_dir / 'users.json'
    if users.exists():
        try:
            n = len(json.loads(users.read_text(encoding='utf-8')))
            item(OK, f'已有 {n} 个账号（升级部署会保留）')
        except ValueError:
            item(BAD, 'users.json 损坏，解析失败', '从备份恢复，或改名留档后让平台重建')
    try:
        free = shutil.disk_usage(data_dir).free / 1024 ** 3
        item(OK, f'磁盘剩余 {free:.1f} GB') if free >= 2 else \
            item(WARN, f'磁盘剩余只有 {free:.1f} GB', '建议至少留 2GB')
    except OSError:
        pass


def check_port():
    print('\n【端口与网络】')
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(('0.0.0.0', PORT))
        item(OK, f'{PORT} 端口空闲')
    except OSError:
        item(WARN, f'{PORT} 端口已被占用',
             '如果那是正在运行的 AI Master，忽略即可；否则启动时会自动清理')
    finally:
        sock.close()
    print(f'\n  提示：本机自检看不出「外面能不能连上」。')
    print(f'        云控制台 → 安全组 → 入方向 → 放行 TCP {PORT}。')


def main():
    print('=' * 62)
    print('  AI Master 上线前自检')
    print('=' * 62)
    check_files()
    check_env()
    check_runtime()
    check_demo_data()
    check_data_dir()
    check_port()
    print('\n' + '=' * 62)
    if problems:
        print(f'  发现 {len(problems)} 个必须处理的问题：')
        for p in problems:
            print(f'    · {p}')
    else:
        print('  自检通过。可以双击「一键上线.bat」了。')
    print('=' * 62)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
