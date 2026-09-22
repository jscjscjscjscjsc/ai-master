"""把平台导出成 GitHub Pages 可用的纯静态站。

Pages 上没有 Flask、没有 Python、没有大模型，所以导出时必须把
「服务端算的东西」换成「浏览器自己算」：

    服务端                    静态站
    ─────────────────────────────────────────────
    渲染 Jinja 模板       →   用 Flask test_client 取渲染后的 HTML，改写链接
    /api/cultivation/*   →   等级表 / 星仪 / 星器 / 试炼 作为 JSON 导出，
                             前端按同一套规则推导（static/js/starlab_static.js）
    /api/roadmap         →   逐日路线的排布规则同样导出参数，前端自己排
    /api/training/*      →   题库整包导出，前端筛选与本地判分
    /api/ask-* / coach   →   没有后端就没有模型。前端明确提示"需本地部署"，
                             而不是留一个转圈的加载中
    用户账号与存档        →   localStorage（在线站不设账号体系）

为什么用 test_client 而不是重写一套静态模板：页面结构、样式、交互脚本
都在 Flask 里，重写等于把同一件事做两遍、以后必然漂移。取渲染结果是
"同一份代码、不同输出"。

图片：教材截图是终端输出，颜色很少，无损 WebP 能压到原体积的 19%
（24MB → 4.6MB），文字完全无损。导出时转换并改写引用。

用法：
    python tools/build_static_site.py                    # 导出到 dist-pages/
    python tools/build_static_site.py --out ../pages     # 指定目录
    python tools/build_static_site.py --no-images        # 跳过图片转换（调试用）
"""

import argparse
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'tools'))

DEFAULT_OUT = os.path.join(os.path.dirname(ROOT), 'dist-pages')

# 平台路由 → 静态文件名。前端 static_mode 会按这张表改写链接。
PAGE_MAP = {
    '/': 'index.html',
    '/roadmap': 'roadmap.html',
    '/agent': 'agent.html',
    '/training': 'training.html',
    '/coach': 'coach.html',
    '/constellation': 'constellation.html',
    '/stars': 'stars.html',
    '/progress': 'progress.html',
    '/login': 'login.html',
    '/transition': 'warp.html',
}

# 这些页面/接口没有后端就没有意义：前端要给出人话提示，而不是让页面空转。
BACKEND_HINTS = {
    '/api/ask-star-stream': 'AI 答疑需要大模型，在线演示站不接模型。下载本地版并填入自己的密钥即可使用。',
    '/api/training/ai-help': 'AI 讲思路需要大模型，在线演示站不接模型。',
    '/api/score-answer': 'AI 评分需要大模型。在线演示站里，选择题仍可本地判分并看解析。',
    '/api/agent/ask': '全局智能体需要大模型，在线演示站不接模型。',
    '/api/agent/suggest': '智能体需要大模型。',
    '/api/agent/blackboard': '智能体需要大模型。',
    '/api/coach/chat': '星辰教练需要大模型。',
    '/api/interview/start': '模拟面试需要大模型。',
    '/api/interview/answer': '模拟面试需要大模型。',
    '/api/tts/speak': '服务端语音需要后端。可用浏览器内置语音代替。',
    '/api/chapter-revelation': '章节启示需要大模型。',
    '/api/setup': '模型密钥只存在你自己电脑上，需本地部署。',
}


def log(message):
    print(message, flush=True)


# ── 1. 导出数据 ─────────────────────────────────────────
def export_data(out_dir):
    """把服务端算的表导出成 JSON，供前端在同一套规则下自己推导。"""
    import star_engine as game
    import starlab_engine as lab

    data_dir = os.path.join(out_dir, 'data')
    os.makedirs(data_dir, exist_ok=True)

    courses = lab.courses()
    bank = lab.load_bank()

    # 课程表：去掉正文里的 HTML 之外不需要的东西，直接整包给前端
    with open(os.path.join(data_dir, 'courses.json'), 'w', encoding='utf-8') as handle:
        json.dump(courses, handle, ensure_ascii=False, separators=(',', ':'))

    # 题库：全部下发（前端要能筛选与本地判分）。
    # 答案一并给 —— 在线站没有服务端可藏，所以"防作弊"不是目标；
    # 真要做题就用本地版。
    with open(os.path.join(data_dir, 'question_bank.json'), 'w', encoding='utf-8') as handle:
        json.dump(bank, handle, ensure_ascii=False, separators=(',', ':'))

    # 修为系统的全部静态表：等级曲线、境界法相、星仪、星器、试炼。
    # 前端 starlab_static.js 用这些表做与 star_engine.py 同样的推导 ——
    # 数据只有一份来源，改平衡只改 Python 侧。
    game_tables = {
        'LEVELS': game.LEVELS,
        'MAX_LEVEL': game.MAX_LEVEL,
        'REALM_ART': game.REALM_ART,
        'REALM_ORDER': game.REALM_ORDER,
        'REALM_RANGE': game.REALM_RANGE,
        'COACH_FORMS': game.COACH_FORMS,
        'COACH_FINAL_STAGES': game.COACH_FINAL_STAGES,
        'STAR_INSTRUMENTS': {str(k): list(v) for k, v in game.STAR_INSTRUMENTS.items()},
        'EQUIPMENT': game.EQUIPMENT,
        'TRIALS': game.TRIALS,
        'POWER_WEIGHT': game.POWER_WEIGHT,
    }
    with open(os.path.join(data_dir, 'star_engine.json'), 'w', encoding='utf-8') as handle:
        json.dump(game_tables, handle, ensure_ascii=False, separators=(',', ':'))

    # 积分规则 + 逐日路线的估算参数：前端要用它们复算分数与排期
    rules = {
        'QUESTION_BASE': {str(k): v for k, v in lab.QUESTION_BASE.items()},
        'STAR_MULT': {str(k): v for k, v in lab.STAR_MULT.items()},
        'FIRST_CLEAR_BONUS': lab.FIRST_CLEAR_BONUS,
        'REPEAT_DECAY': lab.REPEAT_DECAY,
        'KP_POINTS': lab.KP_POINTS,
        'CHAPTER_POINTS': lab.CHAPTER_POINTS,
        'EXAM_FINISH_BASE': lab.EXAM_FINISH_BASE,
        'EXAM_FINISH_PER_Q': lab.EXAM_FINISH_PER_Q,
        'MAX_AWARD': lab.MAX_AWARD,
    }
    try:
        import roadmap
        rules['ROADMAP'] = {
            'CHARS_PER_MINUTE': roadmap.CHARS_PER_MINUTE,
            'PRACTICE_MINUTES': roadmap.PRACTICE_MINUTES,
            'KP_FLOOR_MINUTES': roadmap.KP_FLOOR_MINUTES,
            'REVIEW_MINUTES': roadmap.REVIEW_MINUTES,
            'SPRINT_MINUTES': roadmap.SPRINT_MINUTES,
            'DEFAULT_DAILY_MINUTES': roadmap.DEFAULT_DAILY_MINUTES,
        }
    except Exception:  # noqa: BLE001
        pass
    with open(os.path.join(data_dir, 'rules.json'), 'w', encoding='utf-8') as handle:
        json.dump(rules, handle, ensure_ascii=False, separators=(',', ':'))

    # CG 注册表：章节 → 视觉资产
    registry = {}
    reg_path = os.path.join(lab.DATA_DIR, 'cg_registry.json')
    if os.path.isfile(reg_path):
        with open(reg_path, encoding='utf-8') as handle:
            registry = json.load(handle)
    with open(os.path.join(data_dir, 'cg_registry.json'), 'w', encoding='utf-8') as handle:
        json.dump(registry, handle, ensure_ascii=False, separators=(',', ':'))

    # 知识星海：静态站上直接给出宇宙数据（原来由 /api/knowledge-universe 提供）
    galaxies = []
    palette = [['#7ee1ff', '#2f75c9'], ['#e2b4ff', '#7a4fc9'], ['#8ff0c8', '#2f8f6d'],
               ['#ffd28a', '#c07a2f'], ['#ff9f9f', '#c04f6f'], ['#b8c4ff', '#4f5fc0']]
    total_stars = 0
    for chapter in courses:
        stars = []
        for kp in chapter.get('knowledge_points') or []:
            total_stars += 1
            stars.append({
                'chapter': chapter['id'], 'index': kp['index'], 'title': kp['title'],
                'desc': re.sub('<[^>]+>', '', kp.get('content') or '')[:240],
                'status': 'available',
                'url': 'chapter-%d.html#kp-%d' % (chapter['id'], kp['index'] + 1),
            })
        connections = [[i, i + 1, 'sequence'] for i in range(len(stars) - 1)]
        connections += [[i, i + 2, 'concept'] for i in range(0, len(stars) - 2, 2)]
        galaxies.append({
            'id': 'chapter-%d' % chapter['id'], 'chapter': chapter['id'],
            'name': chapter['title'], 'name_en': 'CHAPTER %02d' % chapter['id'],
            'highlight': bool(chapter.get('highlight')), 'progress': 0,
            'stars': stars, 'connections': connections,
            'palette': palette[chapter['id'] % len(palette)],
        })
    universe = {'success': True,
                'summary': {'galaxies': len(galaxies), 'stars': total_stars, 'completed': 0},
                'galaxies': galaxies}
    with open(os.path.join(data_dir, 'knowledge-universe.json'), 'w', encoding='utf-8') as handle:
        json.dump(universe, handle, ensure_ascii=False, separators=(',', ':'))

    sizes = {}
    for name in os.listdir(data_dir):
        sizes[name] = os.path.getsize(os.path.join(data_dir, name))
    log('数据导出完成：')
    for name, size in sorted(sizes.items()):
        log('   %-28s %6d KB' % (name, size // 1024))
    return {'courses': courses, 'bank': bank, 'registry': registry}


# ── 2. 转换图片 ─────────────────────────────────────────
def convert_images(out_dir, enabled=True):
    """教材截图转无损 WebP。

    它们都是终端输出（1100px 宽、颜色很少），无损 WebP 能压到原体积的
    19% 且文字完全无损 —— 这是把 24MB 的截图放进 git 仓库的前提。
    """
    src = os.path.join(ROOT, 'static', 'course-assets')
    dst = os.path.join(out_dir, 'static', 'course-assets')
    if not os.path.isdir(src):
        return 0, 0
    os.makedirs(dst, exist_ok=True)
    before = after = count = 0
    try:
        from PIL import Image
    except ImportError:
        log('   （缺 Pillow，改为直接复制原图）')
        shutil.copytree(src, dst, dirs_exist_ok=True)
        return 0, 0

    for current, _dirs, files in os.walk(src):
        for name in files:
            source = os.path.join(current, name)
            rel = os.path.relpath(source, src)
            target_rel = os.path.splitext(rel)[0] + '.webp'
            target = os.path.join(dst, target_rel)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            before += os.path.getsize(source)
            if enabled and name.lower().endswith('.png'):
                try:
                    with Image.open(source) as image:
                        image.save(target, 'WEBP', lossless=True, quality=100, method=6)
                    after += os.path.getsize(target)
                    count += 1
                    continue
                except Exception:  # noqa: BLE001
                    pass
            shutil.copy2(source, target)
            after += os.path.getsize(target)
    return before, after


# ── 3. 渲染页面 ─────────────────────────────────────────
def render_pages(out_dir, meta):
    """用 test_client 取每个页面的渲染结果，改写链接后写盘。"""
    import app as platform

    client = platform.app.test_client()
    registry = meta['registry']
    courses = meta['courses']

    def rewrite(html, page_path):
        """把后端路由改成静态文件名。

        必须覆盖 href / src / action / data-url / fetch 字面量 ——
        只改 href 会漏掉 JS 里拼出来的跳转（CG 入口就用 data-url）。
        同时把 CG 注册表里的 /static/xxx 改成相对路径 xxx。
        """
        # 平台页面路由
        for route, filename in sorted(PAGE_MAP.items(), key=lambda kv: -len(kv[0])):
            if route == '/':
                continue
            html = html.replace('href="%s"' % route, 'href="%s"' % filename)
            html = html.replace('action="%s"' % route, 'action="%s"' % filename)
            html = html.replace('data-url="%s"' % route, 'data-url="%s"' % filename)
        # 章节路由 → chapter-N.html（含带锚点、带查询串的写法）
        html = re.sub(r'href="/chapter/(\d+)"', r'href="chapter-\1.html"', html)
        html = re.sub(r'href="/chapter/(\d+)#', r'href="chapter-\1.html#', html)
        # 跃迁页：查询串保留，路由换文件名
        html = html.replace('href="/transition?', 'href="warp.html?')
        # 静态资源：绝对路径 → 相对路径（Pages 可能部署在子路径下）
        html = html.replace('href="/static/', 'href="static/')
        html = html.replace('src="/static/', 'src="static/')
        html = html.replace('data-url="/static/', 'data-url="static/')
        html = html.replace("'/static/", "'static/")
        html = html.replace('"/static/', '"static/')
        # 教材截图换成 WebP
        html = re.sub(r'(static/course-assets/[^"\'\s)]+)\.png', r'\1.webp', html)
        return html

    written = 0
    for route, filename in PAGE_MAP.items():
        response = client.get(route)
        if response.status_code != 200:
            log('   ! %s 返回 %s，跳过' % (route, response.status_code))
            continue
        html = response.get_data(as_text=True)
        html = rewrite(html, route)
        html = inject_static_mode(html)
        with open(os.path.join(out_dir, filename), 'w', encoding='utf-8') as handle:
            handle.write(html)
        written += 1

    for chapter in courses:
        route = '/chapter/%d' % chapter['id']
        response = client.get(route)
        if response.status_code != 200:
            continue
        html = rewrite(response.get_data(as_text=True), route)
        html = inject_static_mode(html)
        with open(os.path.join(out_dir, 'chapter-%d.html' % chapter['id']),
                  'w', encoding='utf-8') as handle:
            handle.write(html)
        written += 1

    log('  页面渲染完成：%d 个' % written)
    return written


def inject_static_mode(html):
    """在 </head> 前插入静态站适配层。

    它必须在页面自己的脚本之前加载：要赶在 starlab_engine 的 fetch
    发出去之前把 window.fetch 换掉。
    """
    tag = ('<script>window.STARLAB_STATIC = true;</script>\n'
           '<script src="static/js/starlab_static.js"></script>\n'
           '<script src="static/js/static_mode_bridge.js"></script>\n')
    if '</head>' in html:
        return html.replace('</head>', tag + '</head>', 1)
    return tag + html


# ── 4. 复制静态资产 ──────────────────────────────────────
def copy_assets(out_dir):
    """复制 CG / 实验室 / 星海 / 音频 / 厂商库。

    这些是纯前端资产，原样可用 —— 但里面的绝对路径引用要保持
    `/static/...` 能被解析：导出后统一改成相对路径。
    """
    mapping = [
        ('static/cg', 'static/cg'),
        ('static/lab', 'static/lab'),
        ('static/atlas', 'static/atlas'),
        ('static/audio', 'static/audio'),
        ('static/vendor', 'static/vendor'),
        ('static/css', 'static/css'),
        ('static/js', 'static/js'),
    ]
    total = 0
    for source_rel, target_rel in mapping:
        source = os.path.join(ROOT, source_rel.replace('/', os.sep))
        target = os.path.join(out_dir, target_rel.replace('/', os.sep))
        if not os.path.isdir(source):
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copytree(source, target, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.map'))
        total += sum(os.path.getsize(os.path.join(c, f))
                     for c, _d, fs in os.walk(target) for f in fs)
    return total


def patch_atlas(out_dir):
    """把独立页面（3D 星海 / 远征）的数据源与返回地址改成静态站可用的形式。

    星海页不走 Flask 模板，数据源写死在页面里指向 `/api/knowledge-universe`。
    在线站没有这个接口，不换掉就会一直转圈 —— 而"转圈"在验收截图里
    看不出和"加载慢"的区别，所以必须显式改。
    """
    patched = []
    atlas_index = os.path.join(out_dir, 'static', 'atlas', 'index.html')
    if os.path.isfile(atlas_index):
        with open(atlas_index, encoding='utf-8') as handle:
            html = handle.read()
        # static/atlas/ 到 data/ 是 ../../data/
        html = html.replace("universeUrl: '/api/knowledge-universe'",
                            "universeUrl: '../../data/knowledge-universe.json'")
        html = html.replace('universeUrl: "/api/knowledge-universe"',
                            'universeUrl: "../../data/knowledge-universe.json"')
        html = html.replace("dashboardUrl: '/'", "dashboardUrl: '../../index.html'")
        html = html.replace('dashboardUrl: "/"', 'dashboardUrl: "../../index.html"')
        with open(atlas_index, 'w', encoding='utf-8') as handle:
            handle.write(html)
        patched.append('星海页数据源 → 导出 JSON')
    return patched


def patch_warp(out_dir):
    """让静态站的跃迁页默认停住。

    渲染 warp.html 时请求的是 `/transition`（不带参数），页面于是用了默认值：
    `data-to="/"` + `data-hold="0"` —— 5.2 秒后自动跳回首页。
    结果是访客打开 warp.html 只会看到闪一下首页，根本看不到跃迁动画。
    静态站没有「上一章/下一章」的上下文，所以默认停住，由页面上的按钮决定去哪。
    """
    path = os.path.join(out_dir, 'warp.html')
    if not os.path.isfile(path):
        return []
    with open(path, encoding='utf-8') as handle:
        html = handle.read()
    for old, new in (
        ('data-to="/" data-hold="0"', 'data-to="index.html" data-hold="1"'),
        ('data-to="/" data-hold="1"', 'data-to="index.html" data-hold="1"'),
        ('href="/">回指挥舱', 'href="index.html">回指挥舱'),
    ):
        html = html.replace(old, new)
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(html)
    return ['跃迁页默认停住（不再自动跳首页）']


def patch_cg_links(out_dir):
    """把 CG 页面内部的跳转改写到静态站的文件名。

    这一步不能靠「按页面所在目录解析相对路径」解决：CG 里的 CTA 写的是
    **平台路由**（`/chapter/2`、`/coach?interview=1`），静态站上根本没有
    这些路径。必须显式换成 chapter-N.html / coach.html。

    这与上一轮 odyssey 的 404 是同一类问题：CG 都从原版搬来，
    链接目标是「平台路由」而不是「某个文件」。导出时必须统一处理，
    否则访客点 CG 结尾那颗按钮就会掉进 404 —— 而 CG 本身看起来完全正常。
    """
    # 账号体系在静态站上不存在（进度存在浏览器 localStorage）。
    # 留着「登录 / 注册」按钮只会把用户引到一个必然失败的页面 ——
    # 所以换成一条说明：进度已经在本机保存，不需要账号。
    account_fixes = [
        (re.compile(r'<a class="btn sm" href="login\.html">登录 / 注册</a>'),
         '<span class="chip green" style="cursor:default">进度存在本机</span>'),
        (re.compile(r'<a class="btn sm" href="[^"]*login\.html">登录 / 注册</a>'),
         '<span class="chip green" style="cursor:default">进度存在本机</span>'),
        # 首页底部的游客提示卡：静态站不需要注册，改成说明
        (re.compile(r'<h3>你目前是游客模式</h3>'),
         '<h3>进度存在你自己的浏览器里</h3>'),
        (re.compile(r'<p>可以浏览全部课程、做题、用智能体答疑，但进度不会保存 —— 换台电脑或清浏览器就要重头再来。\s*注册只需要用户名和密码，进度存在本机。</p>'),
         '<p>在线演示站不需要账号：课程、练习、逐日路线与星空修为都能正常使用，'
         '作答与修为保存在浏览器本地存储里。换台电脑或清浏览器缓存会从零开始；'
         '想长期保存进度，下载本地版即可。</p>'),
        (re.compile(r'<a class="btn primary" href="[^"]*login\.html">注册并保存进度</a>'),
         '<a class="btn" href="static/cg/transformer_cg.html">先看一部开场 CG</a>'),
    ]

    # 退出登录在静态站上没有意义（没有账号，进度在浏览器里）。
    # 换成「清空本机进度」，并挂上 bridge 里的处理函数 ——
    # 留着 /logout 只会是个 404。
    logout_fix = (re.compile(r'<a class="btn sm ghost" href="/logout">退出</a>'),
                  '<a class="btn sm ghost" href="#" data-reset-progress>清空本机进度</a>')
    patterns = [
        # 章节：href / 单双引号字符串 / 拼接写法都要覆盖
        (re.compile(r'href="/chapter/(\d+)"'), r'href="{up}chapter-\1.html"'),
        (re.compile(r'href="/chapter/(\d+)#'), r'href="{up}chapter-\1.html#'),
        (re.compile(r"'/chapter/(\d+)'"), r"'{up}chapter-\1.html'"),
        (re.compile(r'"/chapter/(\d+)"'), r'"{up}chapter-\1.html"'),
        (re.compile(r"'/chapter/'\s*\+\s*CHAPTER_ID"), r"'{up}chapter-' + CHAPTER_ID + '.html'"),
        # 星辰教练：带查询串的写法要保留查询串
        (re.compile(r'"/coach\?interview=1"'), r'"{up}coach.html?interview=1"'),
        (re.compile(r"'/coach\?interview=1'"), r"'{up}coach.html?interview=1'"),
        (re.compile(r"'/coach\?chapter='\s*\+\s*CHAPTER_ID"), r"'{up}coach.html?chapter=' + CHAPTER_ID"),
        (re.compile(r'"/coach\?chapter="'), r'"{up}coach.html?chapter="'),
        (re.compile(r"'/coach\?chapter='"), r"'{up}coach.html?chapter='"),
        (re.compile(r'href="/coach'), r'href="{up}coach.html'),
        # 其余平台页面
        (re.compile(r'href="/training'), r'href="{up}training.html'),
        (re.compile(r'href="/roadmap"'), r'href="{up}roadmap.html"'),
        (re.compile(r'href="/stars"'), r'href="{up}stars.html"'),
        (re.compile(r'href="/constellation"'), r'href="{up}constellation.html"'),
        (re.compile(r'href="/progress"'), r'href="{up}progress.html"'),
        (re.compile(r'href="/transition\?'), r'href="{up}warp.html?'),
    ]
    changed = []
    for current, _dirs, files in os.walk(out_dir):
        # 站点页面的名字（chapter-N.html / coach.html …）都在站点根目录，
        # 而 CG 埋在 static/cg/xxx/ 下 —— 所以链接前缀要按当前目录深度算。
        # 只写 "chapter-2.html" 会被解析成 static/cg/chapter-2.html（404）。
        rel_dir = os.path.relpath(current, out_dir)
        depth = 0 if rel_dir == '.' else rel_dir.count(os.sep) + 1
        up = '../' * depth
        for name in files:
            if not name.endswith('.html'):
                continue
            path = os.path.join(current, name)
            try:
                with open(path, encoding='utf-8') as handle:
                    text = handle.read()
            except (OSError, UnicodeDecodeError):
                continue
            original = text
            for pattern, replacement in patterns:
                text = pattern.sub(replacement.replace('{up}', up), text)
            text = logout_fix[0].sub(logout_fix[1], text)
            for pattern, replacement in account_fixes:
                text = pattern.sub(replacement, text)
            if text != original:
                with open(path, 'w', encoding='utf-8') as handle:
                    handle.write(text)
                changed.append(os.path.relpath(path, out_dir))
    return changed


def relativize_assets(out_dir):
    """把写死的 `/static/...` 绝对路径改成相对路径，并顺手修好已被改过一次的路径。

    为什么必须做：CG 与实验室的 HTML 是从原版搬来的，里面大量使用
    `/static/...`（原本跑在 Flask 下）。GitHub Pages 若部署在子路径
    （user.github.io/repo/），以 `/` 开头的路径会跳到域名根 → 全部 404。

    两个容易错的地方，这里都按同一套规则处理：
      1. **深度**：`static/cg/x.html` 距站点根是 2 层，不是 1 层。
         少算一层前缀，链接就会落在 static/ 里面。
      2. **幂等**：这一步可能跑在已部分改写过的文件上（例如 CG 跳转改写
         已经把某些路径变成相对的）。所以先归一化掉已有的 `../` 前缀，
         再按当前深度重算 —— 否则会出现 `/static/static/` 这种叠加。
    """
    changed = 0
    # 先把可能存在的、指向 static 的重复前缀吃掉（无论几层 ../）
    normalize = re.compile(r'(?:\.\./)+static/')
    absolute = re.compile(r'(["\'(=])(?:\.\./)*/static/')
    for current, _dirs, files in os.walk(out_dir):
        rel_dir = os.path.relpath(current, out_dir)
        depth = 0 if rel_dir == '.' else rel_dir.count(os.sep) + 1
        prefix = '../' * depth
        for name in files:
            if not name.endswith(('.html', '.js', '.css', '.json')):
                continue
            path = os.path.join(current, name)
            try:
                with open(path, encoding='utf-8') as handle:
                    text = handle.read()
            except (OSError, UnicodeDecodeError):
                continue
            if 'static/' not in text:
                continue
            original = text
            # 1) 绝对路径 /static/ → 相对路径（按当前深度）
            text = absolute.sub(lambda m: m.group(1) + prefix + 'static/', text)
            # 2) 已有相对前缀的按当前深度重算，避免 ../ 过多或过少
            text = normalize.sub(prefix + 'static/', text)
            if text != original:
                with open(path, 'w', encoding='utf-8') as handle:
                    handle.write(text)
                changed += 1
    return changed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=DEFAULT_OUT)
    parser.add_argument('--no-images', action='store_true')
    args = parser.parse_args()
    out_dir = os.path.abspath(args.out)

    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    log('导出静态站 → %s\n' % out_dir)
    log('[1/5] 导出数据…')
    meta = export_data(out_dir)

    log('\n[2/5] 转换教材截图…')
    before, after = convert_images(out_dir, enabled=not args.no_images)
    if before:
        log('   %.1f MB → %.1f MB（%.0f%%）' % (before / 1048576, after / 1048576,
                                                after * 100.0 / before))

    log('\n[3/5] 复制 CG / 实验室 / 星海…')
    size = copy_assets(out_dir)
    log('   %.1f MB' % (size / 1048576))

    log('\n[4/5] 渲染页面…')
    render_pages(out_dir, meta)

    log('\n[5/5] 改写资源路径…')
    for row in patch_atlas(out_dir):
        log('   ' + row)
    for row in patch_warp(out_dir):
        log('   ' + row)
    cg_changed = patch_cg_links(out_dir)
    log('   %d 个 CG / 实验室页面内的跳转已改写' % len(cg_changed))
    changed = relativize_assets(out_dir)
    log('   %d 个文件改成相对路径' % changed)

    # 站点标记：让 GitHub Pages 不要用 Jekyll 处理（下划线开头的文件会被忽略）
    open(os.path.join(out_dir, '.nojekyll'), 'w').close()

    total = sum(os.path.getsize(os.path.join(c, f))
                for c, _d, fs in os.walk(out_dir) for f in fs)
    log('\n完成：%d 个文件，共 %.1f MB' % (
        sum(len(fs) for _c, _d, fs in os.walk(out_dir)), total / 1048576))
    return 0


if __name__ == '__main__':
    sys.exit(main())
