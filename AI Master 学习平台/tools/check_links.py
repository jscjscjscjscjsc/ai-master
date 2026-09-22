"""全站内链检查：把每个页面里所有 href / src / data-target 解出来，逐个请求验证。

为什么要它
----------
之前只验证了「页面本身能打开」，没验证「页面里的链接能打开」。
结果 odyssey 这种「点进去再点四个卡片」的页面，第一层是 200、
第二层全是 404 —— 而它在验收截图里看起来完全正常。

这些 CG 是从原版直接搬过来的，里面的相对路径是按原版目录层级写的
（`transformer_cg.html` 假设同目录就有 CG），搬进平台的目录结构后
解析结果就变了。这类问题只能靠遍历链接发现，看不出、猜不出。

用法：
    python tools/check_links.py              # 检查全部
    python tools/check_links.py --only cg    # 只查 CG 目录
"""

import argparse
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('STARLAB_BASE', 'http://127.0.0.1:5178')

# 要爬的页面：三个视觉资产目录 + 平台自己的页面
TARGET_DIRS = ['static/cg', 'static/lab', 'static/atlas']
PLATFORM_PAGES = ['/', '/stars', '/roadmap', '/agent', '/training', '/coach',
                  '/constellation', '/progress', '/login']
CHAPTER_PAGES = ['/chapter/%d' % i for i in range(1, 10)]

ATTR_RE = re.compile(r'(?:href|src|data-target)\s*=\s*["\']([^"\']+)["\']', re.I)

# 这些不算「需要能打开」：锚点、外链、协议、模板占位
SKIP_PREFIX = ('#', 'mailto:', 'tel:', 'javascript:', 'data:', 'http://', 'https://', '//')


def collect_pages(scan_root=None):
    """要检查的页面列表。

    scan_root 用来扫描「静态导出目录」：导出后的文件在另一处、由静态服务器
    提供服务。扫描目录必须与请求指向的目录是同一份文件 —— 否则会得到
    一堆假 404（平台的 CG 与导出的 CG 是两份不同副本）。
    """
    pages = list(PLATFORM_PAGES) + CHAPTER_PAGES
    base = scan_root or ROOT
    for directory in TARGET_DIRS:
        folder = os.path.join(base, directory.replace('/', os.sep))
        for current, _dirs, files in os.walk(folder):
            for name in files:
                if name.endswith('.html'):
                    rel = os.path.relpath(os.path.join(current, name), base)
                    pages.append('/' + rel.replace(os.sep, '/'))
    if scan_root:
        # 导出目录里站点页面是平铺的（chapter-1.html 等直接在根）
        for name in os.listdir(base):
            if name.endswith('.html'):
                pages.append('/' + name)
    return sorted(set(pages))


def fetch(url, timeout=15):
    request = urllib.request.Request(url, headers={'User-Agent': 'starlab-linkcheck'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, b''
    except Exception as exc:  # noqa: BLE001
        return None, str(exc).encode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', default='', help='只查名字含该关键字的页面')
    parser.add_argument('--scan', default='', help='扫描哪个目录（检查导出的静态站时用）')
    args = parser.parse_args()

    status, _ = fetch(BASE + '/')
    if status != 200:
        print('服务没起来（%s 返回 %s）。先启动平台再跑这个检查。' % (BASE, status))
        return 1

    # 平台路由与静态站文件名是两套地址：本地版是 /chapter/1，
    # 导出的静态站是 chapter-1.html。检查哪一套就要用哪一套的清单 ——
    # 混用会把「静态站本来就没有平台路由」报成一堆 404。
    pages = collect_pages(args.scan)
    if args.scan:
        pages = [p for p in pages
                 if p not in PLATFORM_PAGES and not p.startswith('/chapter/')]
    pages = [p for p in pages if not args.only or args.only in p]
    print('检查 %d 个页面的内链…\n' % len(pages))

    broken = []
    checked = 0
    for page in pages:
        status, body = fetch(BASE + page)
        if status != 200:
            broken.append((page, '(页面本身)', 'HTTP %s' % status))
            continue
        try:
            html = body.decode('utf-8', 'ignore')
        except Exception:  # noqa: BLE001
            continue
        links = {}
        for match in ATTR_RE.finditer(html):
            raw = match.group(1).strip()
            if not raw or raw.startswith(SKIP_PREFIX):
                continue
            if '{{' in raw or '{%' in raw:      # Jinja 模板占位
                continue
            # 相对路径按「页面所在目录」解析 —— 这正是原版 CG 搬过来后出错的地方
            resolved = urllib.parse.urljoin(BASE + page, raw)
            if not resolved.startswith(BASE):
                continue
            path = resolved[len(BASE):] or '/'
            # 查询串里的中文要先编码再请求。浏览器 href 会自动编码，
            # 而 urllib 不会 —— 不编码就会把「中文参数」当成坏链误报。
            if '?' in path:
                base_part, _, query = path.partition('?')
                pairs = []
                for item in query.split('&'):
                    key, _, value = item.partition('=')
                    pairs.append(urllib.parse.quote(key, safe='') + '=' +
                                 urllib.parse.quote(value, safe=''))
                path = base_part + '?' + '&'.join(pairs)
            links.setdefault(path, 0)
            links[path] += 1

        page_broken = []
        for path in sorted(links):
            checked += 1
            code, _ = fetch(BASE + path, timeout=10)
            if code != 200:
                page_broken.append((path, code))
        if page_broken:
            broken.append((page, page_broken, ''))
            print('✗ %s' % page, flush=True)
            for path, code in page_broken:
                print('     %-4s %s' % (code, path), flush=True)

    print()
    if not broken:
        print('全部正常：%d 个页面、%d 条内链，没有 404' % (len(pages), checked))
        return 0

    # 逐条列出：Windows 下重定向 stdout 时缓冲会吞掉异常退出前的输出，
    # 所以这里显式 flush，否则只看到一句统计、看不到是哪个页面坏了。
    print('发现 %d 个页面存在坏链（共 %d 条内链被检查）：' % (len(broken), checked), flush=True)
    for row in broken:
        if len(row) == 3 and row[1] == '(页面本身)':
            print('  ✗ %s  %s' % (row[0], row[2]), flush=True)
        else:
            print('  ✗ %s' % row[0], flush=True)
            for path, code in row[1]:
                print('       %-4s %s' % (code, path), flush=True)
    return 1


if __name__ == '__main__':
    sys.exit(main())
