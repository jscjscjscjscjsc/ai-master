"""语音合成：星辰教练与模拟面试的朗读。

主引擎是 edge-tts（微软 Edge 的在线神经网络语音，免费且不需要任何 Key），
浏览器内置语音作为兜底（前端 Web Speech API，完全离线）。

两个刻意的设计：
  1. **缓存按内容哈希**。同一段讲解被反复朗读（复习、跟读、面试重放）时
     不该每次都走一次网络，命中缓存直接返回字节。
  2. **失败永不抛错**。语音是增强功能，合成失败时返回空字节并让前端切浏览器
     语音，绝不能因为 TTS 挂了把整个问答流程打断。
"""

import asyncio
import hashlib
import os
import re
import threading

import starlab_engine as lab

CACHE_DIR = os.path.join(lab.DATA_DIR, 'audio_cache')

# 三套声音分别对应三种使用场景，速率也不同：
#   教练讲解慢一点、面试官正常语速、旁白更快更平。
VOICES = {
    'coach': {'voice': 'zh-CN-YunxiNeural', 'label': '星辰教练 · 云希（男声）',
              'rate': '+6%', 'pitch': '+0Hz'},
    'interviewer': {'voice': 'zh-CN-YunyangNeural', 'label': '面试官 · 云扬（男声）',
                    'rate': '-4%', 'pitch': '-2Hz'},
    'narrator': {'voice': 'zh-CN-XiaoxiaoNeural', 'label': '讲解女声 · 晓晓',
                 'rate': '+12%', 'pitch': '+3Hz'},
}

BROWSER_VOICES = {
    'coach': {'lang': 'zh-CN', 'rate': 1.02, 'pitch': 1.0},
    'interviewer': {'lang': 'zh-CN', 'rate': 0.94, 'pitch': 0.92},
    'narrator': {'lang': 'zh-CN', 'rate': 1.12, 'pitch': 1.06},
}

_TAG_RE = re.compile(r'<[^>]+>')
_MD_RE = re.compile(r'[`*#>_~\[\]()]|\n{2,}')
_LOCK = threading.Lock()
_LOOP = None
_LOOP_LOCK = threading.Lock()
LAST_ERROR = ''


def _loop():
    """一个进程级常驻事件循环。

    为什么不在每次合成时 asyncio.run：Flask 的线程池复用的是同一批线程，
    反复新建/销毁事件循环会和 aiohttp 的连接池打架，表现为「第一次失败、
    第二次成功」这种最难查的现象。常驻一个循环、用 run_coroutine_threadsafe
    提交任务，顺序就稳定了。
    """
    global _LOOP
    if _LOOP is None or _LOOP.is_closed():
        with _LOOP_LOCK:
            if _LOOP is None or _LOOP.is_closed():
                loop = asyncio.new_event_loop()
                thread = threading.Thread(target=loop.run_forever, daemon=True,
                                          name='star-tts-loop')
                thread.start()
                _LOOP = loop
    return _LOOP


def configure(data_dir=None):
    global CACHE_DIR
    CACHE_DIR = os.path.join(str(data_dir), 'audio_cache') if data_dir else os.path.join(lab.DATA_DIR, 'audio_cache')
    os.makedirs(CACHE_DIR, exist_ok=True)


def available():
    try:
        import edge_tts  # noqa: F401
        return True
    except ImportError:
        return False


def clean_text(text, limit=900):
    """把 Markdown / HTML 洗成人能听懂的连续文本。

    朗读最怕的是把 `**加粗**` 和 ``` 代码块 念出来，所以这里全部剥掉；
    代码块直接丢弃 —— 代码念出来没有意义，听的人反而更糊涂。
    """
    raw = str(text or '')
    raw = re.sub(r'```[\s\S]*?```', '（这里有一段代码，请看屏幕）', raw)
    raw = _TAG_RE.sub(' ', raw)
    raw = re.sub(r'^#{1,6}\s*', '', raw, flags=re.M)
    raw = re.sub(r'^\s*[-*+]\s+', '，', raw, flags=re.M)
    raw = re.sub(r'^\s*\d+[.、]\s+', '，', raw, flags=re.M)
    raw = raw.replace('🤔', '。').replace('✨', '')
    raw = _MD_RE.sub(lambda m: '。' if m.group(0).startswith('\n') else '', raw)
    raw = re.sub(r'[ \t]+', ' ', raw)
    raw = re.sub(r'。{2,}', '。', raw)
    raw = re.sub(r'\s*\n\s*', '，', raw)
    raw = re.sub(r'，{2,}', '，', raw)
    return raw.strip()[:limit]


def cache_path(text, character):
    spec = VOICES.get(character) or VOICES['coach']
    digest = hashlib.md5(('%s|%s|%s|%s' % (spec['voice'], spec['rate'], spec['pitch'], text)).encode()).hexdigest()
    return os.path.join(CACHE_DIR, 'voice_%s.mp3' % digest)


def synthesize(text, character='coach'):
    """返回 mp3 字节。任何失败都返回 b''，由前端回落到浏览器语音。"""
    global LAST_ERROR
    spoken = clean_text(text)
    if len(spoken) < 2:
        return b''
    path = cache_path(spoken, character)
    if os.path.exists(path) and os.path.getsize(path) > 1024:
        with open(path, 'rb') as fh:
            return fh.read()
    if not available():
        LAST_ERROR = 'edge-tts 未安装'
        return b''
    spec = VOICES.get(character) or VOICES['coach']
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = '%s.%d.part' % (path, threading.get_ident())
    try:
        future = asyncio.run_coroutine_threadsafe(_synth(spoken, spec, tmp), _loop())
        future.result(timeout=45)
        if os.path.exists(tmp) and os.path.getsize(tmp) > 512:
            os.replace(tmp, path)
            with open(path, 'rb') as fh:
                return fh.read()
        LAST_ERROR = '合成结果为空'
    except Exception as exc:
        LAST_ERROR = '%s: %s' % (type(exc).__name__, exc)
        print('[TTS] 合成失败：%s' % LAST_ERROR, flush=True)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
    return b''


async def _synth(text, spec, path):
    import edge_tts
    communicate = edge_tts.Communicate(text, spec['voice'], rate=spec['rate'], pitch=spec['pitch'])
    await communicate.save(path)


def status():
    return {
        'server_tts': available(),
        'browser_tts': True,
        'primary': 'edge-tts' if available() else 'browser',
        'last_error': LAST_ERROR,
        'voices': {key: {'label': spec['label'], 'server': available(),
                         'browser': BROWSER_VOICES.get(key, {})}
                   for key, spec in VOICES.items()},
    }
