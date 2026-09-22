"""离屏截图：把平台的每个页面渲染成 PNG，用于视觉验收。

为什么要写脚本而不是直接在命令行循环调 Edge：
批量连续启动 Edge 时，前一个进程还没退干净就会锁住 profile，
表现为「单独跑能出图、连着跑就失败」。脚本里做三件事解决它：
  1. 每个页面用独立的 user-data-dir，互不干扰；
  2. 启动后等待进程真正退出（而不是靠 sleep 猜）；
  3. 出图失败自动重试一次，并把 Edge 的原始输出打出来便于定位。

用法：
    python tools/shoot_pages.py                 # 截全部页面
    python tools/shoot_pages.py /agent /coach   # 只截指定页面
"""

import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'logs', 'shots')
BASE = os.environ.get('STARLAB_BASE', 'http://127.0.0.1:5178')
PROFILE_ROOT = os.path.join(os.environ.get('TEMP') or '/tmp', 'starlab_shots')

EDGE_CANDIDATES = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
]

PAGES = [
    ('/', '01-dashboard'),
    ('/roadmap', '02-roadmap'),
    ('/agent', '03-agent'),
    ('/training', '04-training'),
    ('/coach', '05-coach'),
    ('/constellation', '06-constellation'),
    ('/stars', '07-stars'),
    ('/chapter/4', '08-chapter4'),
    ('/progress', '09-progress'),
    ('/login', '10-login'),
]


def browser():
    for path in EDGE_CANDIDATES:
        if os.path.exists(path):
            return path
    return ''


def shoot(exe, url, name, index, width=1560, height=1040, wait=6):
    out = os.path.join(SHOTS, name + '.png')
    if os.path.exists(out):
        os.remove(out)
    profile = os.path.join(PROFILE_ROOT, 'p%02d' % index)
    os.makedirs(profile, exist_ok=True)
    cmd = [exe, '--headless=new', '--disable-gpu', '--no-sandbox',
           '--hide-scrollbars', '--force-device-scale-factor=1',
           '--window-size=%d,%d' % (width, height),
           '--user-data-dir=' + profile,
           '--screenshot=' + out, url]
    proc = subprocess.run(cmd, capture_output=True, stdin=subprocess.DEVNULL, timeout=120)
    deadline = time.time() + wait
    while time.time() < deadline and not os.path.exists(out):
        time.sleep(0.4)
    if os.path.exists(out) and os.path.getsize(out) > 3000:
        return True, os.path.getsize(out), ''
    tail = (proc.stderr or b'')[-400:].decode('utf-8', 'ignore')
    return False, 0, tail


def main():
    targets = sys.argv[1:]
    exe = browser()
    if not exe:
        print('找不到 Edge / Chrome，无法截图')
        return 1
    os.makedirs(SHOTS, exist_ok=True)
    rows = [(url, name) for url, name in PAGES if not targets or url in targets]
    ok = 0
    for index, (url, name) in enumerate(rows, start=1):
        success, size, tail = shoot(exe, BASE + url, name, index)
        if not success:
            time.sleep(1.5)
            success, size, tail = shoot(exe, BASE + url, name, index + 100)
        print('%-18s %-28s %s' % (name, url, ('%d bytes' % size) if success else 'FAIL ' + tail[:160]))
        ok += 1 if success else 0
    print('\n%d / %d 张图写入 %s' % (ok, len(rows), SHOTS))
    return 0 if ok == len(rows) else 1


if __name__ == '__main__':
    sys.exit(main())
