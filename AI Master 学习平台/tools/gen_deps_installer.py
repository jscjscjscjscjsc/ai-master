"""在服务器上装依赖：纯标准库，不需要 pip。

为什么要这么绕
--------------
服务器是全新 Windows，没有 git、没有 pip。而嵌入式 Python 自带的自举
（get-pip.py / ensurepip）在这台机器上都不成（前者运行即报错、
后者 embeddable 版根本没带）。

但 wheel 的本质就是 zip，而 Python 标准库自带 urllib 和 zipfile ——
所以"从镜像抓 wheel + 解压到 site-packages"这条路完全不依赖 pip。

输出一段可被云助手执行的 PowerShell（内嵌 Python here-string）。
用法：python tools/gen_deps_installer.py
"""
from __future__ import annotations

# 依赖清单：名字 → 该包在镜像上的索引页名（--find-links 风格）
PACKAGES = [
    'flask', 'werkzeug', 'jinja2', 'markupsafe', 'itsdangerous', 'click',
    'blinker', 'colorama',
    'waitress',
    'edge-tts', 'aiohttp', 'aiosignal', 'attrs', 'certifi', 'charset-normalizer',
    'frozenlist', 'idna', 'multidict', 'propcache', 'yarl', 'aiohappyeyeballs',
    'tabulate', 'typing-extensions',
]

PY_SCRIPT = r'''
import io, os, re, sys, time, urllib.request, urllib.parse, zipfile

# 多镜像轮询。清华最快但会限流（实测连续抓十几个包就 403），
# 所以一失败就换下一家 —— 每个包独立重试，任何一个镜像通就能装完。
MIRRORS = [
    'https://mirrors.aliyun.com/pypi/simple/',
    'https://mirrors.cloud.tencent.com/pypi/simple/',
    'https://pypi.tuna.tsinghua.edu.cn/simple/',
    'https://pypi.org/simple/',
]
ROOT = r'C:\AIMaster'
SP = os.path.join(ROOT, 'runtime', 'python', 'Lib', 'site-packages')
PKGS = %(pkgs)s
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
os.makedirs(SP, exist_ok=True)


def fetch(url, timeout=90, tries=2):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as exc:
            last = exc
            time.sleep(1.2 * (i + 1))
    raise last


def pick(html, pkg, mirror):
    """从索引页里挑一个 wheel 链接。

    两个坑都实测踩过：
      1. 镜像的链接是**相对路径**（`../../packages/xx/yy/<文件>.whl#sha256=...`），
         且带 `#sha256=` 片段 —— 片段必须去掉，否则拿它当 URL 直接失败。
      2. 相对路径要相对**索引页本身**（`/simple/<pkg>/`）解析，
         `../../packages/...` 正好落到 `/packages/...`；
         基准少一个斜杠就会算错一层。

    优先 cp312-win_amd64（带编译扩展的，如 aiohttp/multidict）→ py3-none-any（纯 Python）。
    sdist（.tar.gz）一律不要：那要编译，服务器上没这条件。
    """
    hrefs = re.findall(r'href=["\']([^"\']+\.whl[^"\']*)["\']', html)
    hrefs = [h.split('#', 1)[0] for h in hrefs]
    if not hrefs:
        return None
    win = [h for h in hrefs if 'cp312' in h and 'win_amd64' in h]
    anyw = [h for h in hrefs if 'py3-none-any' in h]
    chosen = (win or anyw or hrefs)[-1]
    if chosen.startswith('http'):
        return chosen
    return urllib.parse.urljoin(mirror + pkg.replace('_', '-') + '/', chosen)


print('=== INSTALL (stdlib only, no pip) ===')
ok, fail = [], []
for pkg in PKGS:
    got = False
    last_err = ''
    for mirror in MIRRORS:
        try:
            name = pkg.replace('_', '-')
            html = fetch(mirror + name + '/').decode('utf-8', 'ignore')
            url = pick(html, pkg, mirror)
            if not url:
                last_err = 'no wheel'
                continue
            blob = fetch(url, timeout=180)
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                z.extractall(SP)
            ok.append(pkg)
            print('  ok   ' + pkg.ljust(20) + str(len(blob) // 1024) + 'KB  @' +
                  mirror.split('/')[2])
            got = True
            break
        except Exception as exc:
            last_err = str(exc)[:50]
            continue
    if not got:
        fail.append((pkg, last_err))
        print('  FAIL ' + pkg.ljust(20) + last_err)

print('=== RESULT ===')
print('installed=' + str(len(ok)) + ' failed=' + str(len(fail)))

# 装完立刻验证——这一步不过，前面装的全白搭
print('=== VERIFY ===')
try:
    import flask, waitress, edge_tts
    print('DEPS_OK flask=' + flask.__version__)
except Exception as exc:
    print('DEPS_FAIL ' + type(exc).__name__ + ': ' + str(exc)[:150])
'''


def build() -> str:
    pkgs = '[' + ', '.join(f"'{p}'" for p in PACKAGES) + ']'
    script = PY_SCRIPT.replace('%(pkgs)s', pkgs)
    return (
        "$ErrorActionPreference='Continue'\n"
        "$py = 'C:\\AIMaster\\runtime\\python\\python.exe'\n"
        "$tmp = 'C:\\AIMaster\\_install_deps.py'\n"
        "@'\n" + script + "\n'@ | Set-Content -Path $tmp -Encoding UTF8\n"
        "& $py $tmp\n"
    )


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    print(build())
