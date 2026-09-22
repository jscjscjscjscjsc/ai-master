"""把原版 AI Master 的电影级 CG / 实验室接到 40 天课程上。

为什么要一个注册表，而不是散落各处的硬编码
----------------------------------------
「哪一章配哪个 CG、哪个实验室」是一条会变的业务规则：
以后加了新 CG、换了章节顺序，都只改这里一处。
平台其它地方（章节页、智能体、知识星海）只问 cg_registry.py「这一章有什么」，
不自己写死路径 —— 否则加一个 CG 要改五个文件。

同时负责把搬进来的静态资源里写死的相对路径改成平台路由：
    原版：../chapter/2        →  平台：/chapter/2
    原版：../../chapter/5     →  平台：/chapter/5
    原版：placeholder APP_URL →  平台：对应章节
原版这些页面是为「深一层目录」写的，现在是 /static/cg/ 下，层级不同。

用法：
    python tools/attach_cg_assets.py          # 修正路径（幂等）
    python tools/attach_cg_assets.py --check  # 只报告不改
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, 'static')

# ── 章节 → 视觉资产 ─────────────────────────────────────
# kind: cine = 电影级开场 CG（章节页顶部的「开场」入口）
#       lab  = 可动手的实验室（学生自己操作、看结果）
#       show = 产品展示页（读材料型）
# 每一项都要给 title / blurb，因为章节页要把它们当按钮文案渲染出来 ——
# 「点进去是什么」必须写在按钮上，否则学生不敢点。
REGISTRY = {
    # 第 1 章：大模型认知与 Prompt 工程（Day 01–05）
    # 提示词 CG 属于这一章 —— 它讲的就是 Prompt 工程，不是第 3 章。
    1: [
        {'kind': 'cine', 'url': '/static/cg/llm_intro.html',
         'title': '开场 · 走进大模型', 'blurb': '5 幕讲清 LLM 是什么、从哪来、怎么训出来'},
        {'kind': 'cine', 'url': '/static/cg/prompt_cg_starlab/index.html',
         'title': '开场 · 提示词工程', 'blurb': '6 幕 CG：从「会说话」到「可控输出」'},
        {'kind': 'lab', 'url': '/static/lab/bpe_game.html',
         'title': '实验室 · BPE 分词器', 'blurb': '亲手做一次 BPE 合并，看 token 是怎么切出来的'},
        {'kind': 'lab', 'url': '/static/lab/llm_training_game.html',
         'title': '实验室 · 训练模拟器', 'blurb': '跑一遍 预训练 → SFT → 对齐，看 loss 曲线怎么降'},
    ],
    # 第 2 章：LLM API 工程化与 AI 后端（Day 06–10）
    # 原版没有这一章，CG 是新做的 —— 按 transformer_cg 的引擎与水准。
    2: [
        {'kind': 'cine', 'url': '/static/cg/api_engineering_cg.html',
         'title': '开场 · 从函数到服务', 'blurb': '5 幕：并发、SSE 流式、重试限流、六层后端'},
    ],
    # 第 3 章：RAG 检索增强生成（Day 11–16）
    3: [
        {'kind': 'cine', 'url': '/static/cg/rag_cg/index.html',
         'title': '开场 · RAG 技术叙事', 'blurb': '6 幕 CG：为什么「外挂知识库」能治幻觉'},
        {'kind': 'lab', 'url': '/static/cg/rag_starlab/index.html',
         'title': '实验室 · 私有 RAG 全链路', 'blurb': '混合检索 + 重排 + 引用，六步走完一条 RAG 管线'},
        {'kind': 'cine', 'url': '/static/cg/prompt_cg.html',
         'title': '开场 · 提示词简史', 'blurb': '另一版叙事：提示词工程是怎么变成一门工程的'},
    ],
    # 第 4 章：Agent 核心机制（Day 17–20）
    4: [
        {'kind': 'cine', 'url': '/static/cg/agentic_cg/index.html',
         'title': '开场 · 驾驭智能体', 'blurb': '5 幕 CG：Agent 到底比「一次性问答」多了什么'},
    ],
    # 第 5 章：Agent 框架实战（Day 21–25）
    # 新做的 CG 讲状态图/断点续跑/人工审批；Claude Code 作为真实产品对照。
    5: [
        {'kind': 'cine', 'url': '/static/cg/agent_framework_cg.html',
         'title': '开场 · 把循环画成图', 'blurb': '5 幕：State/Node/Edge、断点续跑、人工审批'},
        {'kind': 'cine', 'url': '/static/cg/claude_cg/index.html',
         'title': '对照 · Claude Code 实战', 'blurb': '框架之外：一个真实编码智能体的全流程'},
    ],
    # 第 6 章：多智能体系统与 MCP（Day 26–30）—— 平台主线收官
    6: [
        {'kind': 'cine', 'url': '/static/cg/multi_agent_cg.html',
         'title': '开场 · 一群 Agent 与一条协议', 'blurb': '5 幕：三种协作模式、MCP 无状态、成本护栏'},
    ],
    # 第 7 章：开源 Agent 项目源码拆解（Day 31–34）
    7: [
        {'kind': 'show', 'url': '/static/cg/trae_tutorial/index.html',
         'title': '实战 · Trae 智能体教程', 'blurb': '用真实 IDE 智能体读一遍别人的项目'},
    ],
    # 第 8 章：模型微调与上下文工程（Day 35–37）
    # Attention 论文 CG 放这里 —— 这一章的 Day 35 就要讲注意力与 LoRA 原理。
    8: [
        {'kind': 'cine', 'url': '/static/cg/transformer_cg.html',
         'title': '开场 · Attention 论文', 'blurb': '6 幕电影级 CG：一篇论文如何改写整个行业'},
        {'kind': 'lab', 'url': '/static/lab/transformer_lab.html',
         'title': '实验室 · 注意力可视化', 'blurb': '亲手调 Q/K/V，看注意力热力图实时变化'},
    ],
    # 第 9 章：全栈落地与毕业项目（Day 38–40）
    9: [
        {'kind': 'show', 'url': '/static/cg/workbuddy_showcase.html',
         'title': '实战 · WorkBuddy 拆解', 'blurb': '一个真实办公智能体的三层架构与六种能力'},
        {'kind': 'show', 'url': '/static/cg/zcode_showcase.html',
         'title': '实战 · ZCode 拆解', 'blurb': '从新手村到 Hooks / Skills 的高手之路'},
    ],
}

# 学完一章后的「星辰启示」页（原版 revelation_cg，之前搬进来却没接任何入口）。
# 它自取 /api/chapter-revelation/<ch>，所以每章都能用，不需要逐个配置。
REVELATION = {'kind': 'cine', 'url': '/static/cg/revelation_cg.html',
              'title': '收束 · 星辰启示', 'blurb': '翻过这一章时，看一眼星图留言'}

# 原版「沉浸远征」是跨章节的 3D 星门，不属于某一章 —— 单独挂成全局入口。
GLOBAL_ASSETS = [
    {'kind': 'cine', 'url': '/static/cg/ai_odyssey.html',
     'title': '沉浸远征 · 3D 星门', 'blurb': '穿过星门，沿着 3D 航线进入四个章节'},
]

# ── 路径修正 ────────────────────────────────────────────
# 每一条：(文件相对 static/ 的路径, 查找, 替换)
# 只改「跳转到平台页面」的路径，不碰资源引用 —— 资源已经按原目录结构复制好了。
REWRITES = [
    # 原版 ai_odyssey 的回首页按钮
    # CG 单页原本在 static/ 下、CTL 指向 ../chapter/N；现在在 static/cg/ 下，仍是 ../chapter/N
    # 但平台的章节路由是 /chapter/N（根路径），所以要换成绝对路径。
    ('cg/transformer_cg.html', "../chapter/", "/chapter/"),
    ('cg/prompt_cg.html', "../chapter/", "/chapter/"),
    ('cg/llm_intro.html', "../chapter/", "/chapter/"),
    ('cg/llm_intro.html', '"https://your-ai-app.example.com"', "'/chapter/1'"),
    ('lab/bpe_game.html', '"https://your-ai-app.example.com"', "'/chapter/1'"),
    ('lab/llm_training_game.html', '"https://your-ai-app.example.com"', "'/chapter/1'"),
    ('lab/transformer_lab.html', "../chapter/", "/chapter/"),
    # 远征页 / 星海页的回首页按钮
    ('cg/ai_odyssey.html', "../dashboard", "/"),
    ('atlas/ai_odyssey.html', "../dashboard", "/"),
    ('atlas/index.html', "../dashboard/", "/"),
    # CG 目录内的 React SPA：CTA 指向 ../../chapter/N
    ('cg/claude_cg/index.html', "../../chapter/", "/chapter/"),
    ('cg/prompt_cg_starlab/index.html', "../../chapter/", "/chapter/"),
    ('cg/rag_cg/index.html', "../../chapter/", "/chapter/"),
    ('cg/agentic_cg/index.html', "../../chapter/", "/chapter/"),
]

# React SPA 的 CTA 在打包后的 js 里，单独处理
BUNDLE_REWRITES = [
    ('cg/claude_cg/assets', 'chapter/5'),
    ('cg/prompt_cg_starlab/assets', 'chapter/3'),
    ('cg/rag_cg/assets', 'chapter/6'),
]

# agentic_cg 用 CONFIG 配置学习目标
AGENTIC_CONFIG = ('cg/agentic_cg/app.js',
                  re.compile(r'learningUrl\s*:\s*["\'][^"\']*["\']'),
                  'learningUrl: "/chapter/4"')


def apply_rewrites(check=False):
    changed = []
    for rel, find, replace in REWRITES:
        path = os.path.join(STATIC, rel.replace('/', os.sep))
        if not os.path.isfile(path):
            continue
        with open(path, encoding='utf-8', errors='ignore') as handle:
            text = handle.read()
        if find not in text:
            continue
        new = text.replace(find, replace)
        if new != text:
            changed.append('%s  %s → %s (%d 处)' % (rel, find, replace, text.count(find)))
            if not check:
                with open(path, 'w', encoding='utf-8') as handle:
                    handle.write(new)

    # React 打包产物里的章节链接
    for directory, target in BUNDLE_REWRITES:
        folder = os.path.join(STATIC, directory.replace('/', os.sep))
        if not os.path.isdir(folder):
            continue
        for name in os.listdir(folder):
            if not name.endswith('.js'):
                continue
            path = os.path.join(folder, name)
            with open(path, encoding='utf-8', errors='ignore') as handle:
                text = handle.read()
            pattern = re.compile(r'(\.\./)+chapter/\d+')
            found = pattern.findall(text)
            if not found:
                continue
            number = re.search(r'chapter/(\d+)', text)
            changed.append('%s/%s  %d 个相对章节链接 → /%s' %
                           (directory, name, len(found), target))
            if not check:
                with open(path, 'w', encoding='utf-8') as handle:
                    handle.write(pattern.sub('/' + target, text))

    # agentic_cg 的 CONFIG
    rel, pattern, replacement = AGENTIC_CONFIG
    path = os.path.join(STATIC, rel.replace('/', os.sep))
    if os.path.isfile(path):
        with open(path, encoding='utf-8', errors='ignore') as handle:
            text = handle.read()
        if 'learningUrl: "/chapter/4"' not in text:
            new = pattern.sub(replacement, text, count=1)
            if new != text:
                changed.append('%s  CONFIG.learningUrl → /chapter/4' % rel)
                if not check:
                    with open(path, 'w', encoding='utf-8') as handle:
                        handle.write(new)
    return changed


def verify_assets():
    """确认注册表里列的每个文件真的存在 —— 少一个文件就是一个死按钮。"""
    missing = []
    total = 0
    for chapter_id, items in REGISTRY.items():
        for item in items:
            total += 1
            path = os.path.join(STATIC, item['url'].replace('/static/', '', 1).replace('/', os.sep))
            if not os.path.exists(path):
                missing.append('ch%d %s → %s' % (chapter_id, item['title'], item['url']))
    return total, missing


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='只报告，不修改')
    args = parser.parse_args()

    print('=== 章节 × 视觉资产 ===')
    for chapter_id in sorted(REGISTRY):
        for item in REGISTRY[chapter_id]:
            print('  ch%-2d [%-4s] %-22s %s' % (chapter_id, item['kind'], item['title'], item['url']))
    total, missing = verify_assets()
    print('\n共 %d 个入口' % total)
    if missing:
        print('缺少文件 %d 个：' % len(missing))
        for row in missing:
            print('  - %s' % row)
    else:
        print('文件全部就位')

    print('\n=== 路径修正 ===')
    changed = apply_rewrites(check=args.check)
    if changed:
        for row in changed:
            print('  %s' % row)
    else:
        print('  无需修正（已是最新）')

    # 把注册表写一份 JSON 给前端读，避免前端也维护一份
    out = os.path.join(ROOT, 'data', 'cg_registry.json')
    payload = {}
    for key, items in REGISTRY.items():
        # 每章末尾追加「星辰启示」：它是通用的收束入口，不属于某个 CG 主题
        payload[str(key)] = list(items) + [REVELATION]
    payload['global'] = GLOBAL_ASSETS
    with open(out, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
    print('\n注册表已写出：%s' % out)
    return 0 if not missing else 1


if __name__ == '__main__':
    sys.exit(main())
