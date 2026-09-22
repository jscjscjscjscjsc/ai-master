"""OpenAI 兼容的大模型传输层，带受限流式读取、额度降级与重试。

这个模块是平台唯一直接碰网络模型的地方：
  - 环境变量从项目根目录的 .env 读取（进程环境优先），
  - 主模型额度耗尽时自动切备用模型，
  - 连建阶段失败会重试，但流一旦开始吐字就不再重试（避免把半截回答重来一遍），
  - 默认关闭推理模型的思考过程 —— 面向学生的问答要的是即时感。
"""

import json
import os
import time
import uuid
import threading
import urllib.error
import urllib.request

BASE = 'https://ark.cn-beijing.volces.com/api/v3'
DEFAULT_MODEL = 'doubao-seed-2-0-code-preview-260215'

# 有些网关会对 urllib 默认 UA 直接 403，用浏览器 UA 才过得去。
BROWSER_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')

ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
AI_CONFIG_KEYS = ('STARLAB_AI_BASE_URL', 'STARLAB_AI_MODEL', 'STARLAB_AI_FALLBACK_MODELS',
                  'ARK_API_KEY', 'STARLAB_API_KEY')


def _load_local_env():
    """把 .env 读进 os.environ（已存在的进程环境变量优先，不被文件覆盖）。"""
    try:
        with open(ENV_FILE, encoding='utf-8') as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, value = line.split('=', 1)
                key, value = key.strip(), value.strip()
                if key:
                    os.environ.setdefault(key, value)
    except OSError:
        pass


_load_local_env()


def endpoint(url):
    base = (url or BASE).strip().rstrip('/')
    if base.endswith('/chat/completions'):
        return base
    if base.endswith(('/v1', '/v3')):
        return base + '/chat/completions'
    return base + '/v1/chat/completions'


class ArkError(Exception):
    """所有模型侧失败的统一异常，message 直接面向用户。"""


class ArkClient:
    def __init__(self):
        self.url = endpoint(os.getenv('STARLAB_AI_BASE_URL', BASE))
        self.key = (os.getenv('ARK_API_KEY') or os.getenv('STARLAB_AI_API_KEY')
                    or os.getenv('STARLAB_API_KEY', ''))
        models = [os.getenv('STARLAB_AI_MODEL', DEFAULT_MODEL)]
        models += [m.strip() for m in os.getenv('STARLAB_AI_FALLBACK_MODELS', '').split(',') if m.strip()]
        self.models = list(dict.fromkeys(models))
        self.exhausted = set()
        self.lock = threading.Lock()
        self.active_model = self.models[0]
        self.session_id = str(uuid.uuid4())
        # 推理模型的思考过程会把首字延迟从 2 秒级推到 8 秒级，
        # 学习场景要的是即时反馈，所以默认关掉，需要时可开。
        self.thinking_disabled = os.getenv('STARLAB_AI_THINKING', 'disabled').strip().lower() != 'enabled'

    # ── 错误分类 ────────────────────────────────────────
    @staticmethod
    def quota_error(code):
        """额度类错误：可以换备用模型继续。"""
        return code in {'InsufficientQuota', 'QuotaExceeded', 'FreeTierQuotaExceeded',
                        'AllocationQuota.FreeTierOnly', 'QuotaExceeded.FreeTier'}

    @staticmethod
    def overdue_error(code):
        """欠费：密钥本身有效，提示必须指向充值而不是换 key。"""
        return code in {'AccountOverdueError', 'AccountOverdue'}

    def _open_stream(self, model, payload):
        """发起流式请求拿响应对象。

        为什么要重试：实测同一句话连发 6 次，5 次稳定 2 秒返回，但会有一次
        整个卡住 47 秒（服务端偶发不响应）。原来只有一次机会，用户看到的就是
        「连接超时」；隔几秒重试基本都能成。重试只做在建连阶段 —— 流一旦开始
        吐字就不再重试，否则会把已经显示给用户的半截回答重来一遍。
        """
        attempts = max(1, int(os.getenv('STARLAB_AI_RETRY', '3')))
        connect_timeout = int(os.getenv('STARLAB_AI_CONNECT_TIMEOUT', '20'))
        last_error = None
        for attempt in range(1, attempts + 1):
            request = urllib.request.Request(
                self.url, data=json.dumps(payload).encode(),
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + self.key,
                    'User-Agent': BROWSER_UA,
                    'x-opencode-session': self.session_id,
                })
            try:
                return urllib.request.urlopen(request, timeout=connect_timeout)
            except urllib.error.HTTPError:
                # 鉴权 / 限流 / 额度类错误重试没有意义，交给上层分类
                raise
            except (OSError, ValueError) as exc:
                last_error = exc
                if attempt < attempts:
                    time.sleep(0.8 * attempt)
        raise ArkError(
            '模型连接超时（已重试 %d 次）。网络不稳或服务商临时无响应时会这样，'
            '稍后再试；若长期如此，可在配置页换用备用模型。' % attempts) from last_error

    # ── 流式接口 ────────────────────────────────────────
    def events(self, messages, max_tokens=800, temperature=0.35):
        """产出事件流：model / delta / finish / usage / switch。失败抛 ArkError。"""
        if not self.key:
            raise ArkError('请在本机 .env 中设置 ARK_API_KEY。')
        deadline = time.monotonic() + 55
        with self.lock:
            models = [m for m in self.models if m not in self.exhausted]
        for model in models:
            payload = {'model': model, 'messages': messages, 'stream': True,
                       'max_tokens': max_tokens, 'temperature': temperature,
                       'stream_options': {'include_usage': True}}
            if self.thinking_disabled or model.startswith('doubao-seed'):
                payload['thinking'] = {'type': 'disabled'}
            try:
                with self._open_stream(model, payload) as response:
                    self.active_model = model
                    yield {'type': 'model', 'model': model}
                    ended = False
                    for raw in response:
                        if time.monotonic() > deadline:
                            raise ArkError('回答超时，请缩短问题后重试。')
                        line = raw.decode('utf-8').strip()
                        if not line.startswith('data:'):
                            continue
                        content = line[5:].strip()
                        if content == '[DONE]':
                            ended = True
                            break
                        event = json.loads(content)
                        if event.get('error'):
                            raise ArkError('模型返回错误，请稍后重试。')
                        choices = event.get('choices') or []
                        if choices:
                            delta = choices[0].get('delta', {}).get('content')
                            if delta:
                                yield {'type': 'delta', 'text': delta}
                            if choices[0].get('finish_reason'):
                                yield {'type': 'finish', 'reason': choices[0]['finish_reason']}
                        if event.get('usage'):
                            yield {'type': 'usage', 'usage': event['usage']}
                    if not ended:
                        raise ArkError('连接中断，回答可能不完整，请重试。')
                    return
            except urllib.error.HTTPError as exc:
                try:
                    code = json.loads(exc.read()).get('error', {}).get('code', '')
                except (ValueError, AttributeError):
                    code = ''
                if self.quota_error(code):
                    with self.lock:
                        self.exhausted.add(model)
                    yield {'type': 'switch', 'message': '当前模型额度已用尽，正在尝试备用模型。'}
                    continue
                if self.overdue_error(code):
                    raise ArkError('模型账号已欠费（AccountOverdueError），AI 功能全部不可用；'
                                   '请到服务商控制台充值，或换成其他服务商的 Key。') from None
                if exc.code in (401, 403):
                    raise ArkError('模型鉴权或模型权限失败（HTTP %s），请核对 API Key 与模型名。'
                                   % exc.code) from None
                if exc.code == 429:
                    raise ArkError('模型请求限流，请稍后再试。') from None
                raise ArkError('模型服务返回 HTTP %s，请检查模型配置。' % exc.code) from None
            except (OSError, ValueError) as exc:
                raise ArkError('模型连接超时或返回格式异常，请稍后重试。') from exc
        raise ArkError('所配置模型的可用额度已耗尽，请配置仍有额度的备用模型。')

    def complete(self, messages, max_tokens=800, temperature=0.35):
        """把流式结果拼成完整字符串。需要结构化输出时用它。"""
        return ''.join(event['text'] for event in
                       self.events(messages, max_tokens, temperature)
                       if event['type'] == 'delta')

    def probe(self):
        """连通性自检：返回 (ok, message 或 模型名)。"""
        if not self.key:
            return False, '尚未配置 API Key'
        try:
            text = self.complete([{'role': 'user', 'content': '只回复两个字：在线'}], max_tokens=12)
        except ArkError as exc:
            return False, str(exc)
        return bool(text.strip()), ('%s · %s' % (self.active_model, text.strip()[:20]))
