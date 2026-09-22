"""章节页内容完整性检查：把渲染后的 DOM 文本抓下来，逐项核对。

为什么需要它：章节页有 2 万多像素高，任何人工或视觉审阅都只能看到
缩略图，没法确认"正文有没有被截断、题目有没有漏、表格有没有坏"。
这个脚本直接从渲染后的页面里读出结构化的统计（知识点数、题目数、
每节正文字数、代码块数、表格数），用数字判断完整性。

用法：python tools/content_check.py [章节号...]
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('STARLAB_BASE', 'http://127.0.0.1:5178')
PORT = 9345
EDGE = [p for p in (
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe') if os.path.exists(p)]

EXPR = """(() => {
  const kps = [...document.querySelectorAll('.kp')].map((kp) => {
    const lesson = kp.querySelector('.lesson');
    const cards = [...kp.querySelectorAll('.qcard')];
    const text = lesson ? lesson.innerText : '';
    return {
      title: (kp.querySelector('h3') || {}).textContent || '',
      chars: text.length,
      h3: lesson ? lesson.querySelectorAll('h3').length : 0,
      pre: lesson ? lesson.querySelectorAll('pre').length : 0,
      table: lesson ? lesson.querySelectorAll('table').length : 0,
      li: lesson ? lesson.querySelectorAll('li').length : 0,
      questions: cards.length,
      qTypes: cards.map((c) => c.dataset.type),
      hasStatement: cards.filter((c) => (c.querySelector('.q-statement')||{}).innerText?.length > 5).length,
      hasOptions: cards.filter((c) => c.querySelectorAll('.q-option').length === 4).length,
      hasAnswerBox: cards.filter((c) => c.querySelector('.q-answer')).length,
      expanded: !kp.querySelector('.kp-body').hidden,
    };
  });
  const totalQ = kps.reduce((s, k) => s + k.questions, 0);
  return { kpCount: kps.length, totalQ, kps };
})()"""


def main():
    if not EDGE:
        print('找不到 Edge')
        return 1
    chapters = sys.argv[1:] or [str(i) for i in range(1, 14)]
    profile = os.path.join(os.environ.get('TEMP', '/tmp'), 'starlab_content')
    proc = subprocess.Popen([EDGE[0], '--headless=new', '--disable-gpu', '--no-sandbox',
                             '--remote-debugging-port=%d' % PORT,
                             '--user-data-dir=' + profile,
                             '--window-size=1600,1000', 'about:blank'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
    try:
        ws_url = None
        for _ in range(40):
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % PORT, timeout=2) as fh:
                    for target in json.load(fh):
                        if target.get('type') == 'page':
                            ws_url = target['webSocketDebuggerUrl']
                            break
                if ws_url:
                    break
            except Exception:
                time.sleep(0.4)
        if not ws_url:
            print('连不上调试端口')
            return 1

        # 这里用 websocket-client 会多一个依赖，所以走「CDP over websocket」的
        # 极简实现：只需要单向发命令 + 收一条结果。
        import base64
        import hashlib
        import socket
        import struct

        raise SystemExit(_drive(ws_url, chapters))
    finally:
        proc.kill()


def _drive(ws_url, chapters):
    """最小 websocket 客户端：够用来跑一次 Runtime.evaluate。"""
    import base64
    import json as _json
    import os as _os
    import socket
    import struct
    import urllib.parse

    parsed = urllib.parse.urlparse(ws_url)
    sock = socket.create_connection((parsed.hostname, parsed.port), timeout=30)
    key = base64.b64encode(_os.urandom(16)).decode()
    sock.sendall((
        'GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
        'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n'
        % (parsed.path, parsed.hostname, parsed.port, key)).encode())
    header = b''
    while b'\r\n\r\n' not in header:
        header += sock.recv(4096)

    def send_text(text):
        payload = text.encode()
        mask = _os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        length = len(payload)
        if length < 126:
            frame = struct.pack('!BB', 0x81, 0x80 | length)
        elif length < 65536:
            frame = struct.pack('!BBH', 0x81, 0x80 | 126, length)
        else:
            frame = struct.pack('!BBQ', 0x81, 0x80 | 127, length)
        sock.sendall(frame + mask + masked)

    def recv_text():
        while True:
            head = sock.recv(2)
            if not head:
                return ''
            opcode = head[0] & 0x0F
            length = head[1] & 0x7F
            if length == 126:
                length = struct.unpack('!H', sock.recv(2))[0]
            elif length == 127:
                length = struct.unpack('!Q', sock.recv(8))[0]
            data = b''
            while len(data) < length:
                data += sock.recv(length - len(data))
            if opcode == 0x1:
                return data.decode('utf-8', 'ignore')
            if opcode == 0x8:
                return ''

    counter = [0]

    def call(method, params=None):
        counter[0] += 1
        ident = counter[0]
        send_text(_json.dumps({'id': ident, 'method': method, 'params': params or {}}))
        while True:
            raw = recv_text()
            if not raw:
                return {}
            msg = _json.loads(raw)
            if msg.get('id') == ident:
                return msg.get('result', {})

    call('Page.enable')
    call('Network.enable')
    login = urllib.request.Request(BASE + '/api/login',
                                   data=_json.dumps({'username': '验收同学', 'password': 'test123456'}).encode(),
                                   headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(login, timeout=20) as response:
        cookie = response.headers.get('Set-Cookie') or ''
    if cookie:
        name, value = cookie.split(';')[0].split('=', 1)
        call('Network.setCookie', {'name': name, 'value': value, 'domain': '127.0.0.1', 'path': '/'})
    call('Emulation.setDeviceMetricsOverride',
         {'width': 1600, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False})

    problems = []
    for chapter in chapters:
        call('Page.navigate', {'url': '%s/chapter/%s' % (BASE, chapter)})
        time.sleep(3.6)
        result = call('Runtime.evaluate', {'expression': EXPR, 'returnByValue': True})
        value = (result or {}).get('result', {}).get('value') or {}
        if not value:
            print('ch%-3s 取不到数据' % chapter)
            problems.append('ch%s 无数据' % chapter)
            continue
        print('\n第 %s 章：%d 个知识点，%d 道题' % (chapter, value['kpCount'], value['totalQ']))
        for kp in value['kps']:
            flag = ''
            if kp['chars'] < 400:
                flag += ' 正文字数偏少'
            if kp['questions'] == 0:
                flag += ' 无题目'
            if kp['questions'] and kp['hasStatement'] != kp['questions']:
                flag += ' 有题目缺题干'
            if kp['hasAnswerBox'] + kp['hasOptions'] < kp['questions']:
                flag += ' 有题目缺作答区'
            if not kp['expanded']:
                flag += ' 默认未展开'
            if kp['h3'] < 2:
                flag += ' 小节偏少'
            if flag:
                problems.append('ch%s「%s」:%s' % (chapter, kp['title'][:14], flag))
            print('   %-30s %5d字 h3=%-2d pre=%-2d 表=%-2d 题=%-2d %s'
                  % (kp['title'][:28], kp['chars'], kp['h3'], kp['pre'], kp['table'],
                     kp['questions'], '⚠' + flag if flag else '✓'))
    print('\n' + ('全部检查通过' if not problems else '发现 %d 处问题：' % len(problems)))
    for line in problems:
        print('  - ' + line)
    return 0 if not problems else 1


if __name__ == '__main__':
    sys.exit(main())
