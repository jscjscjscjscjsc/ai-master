"""把 AI Master 的公开章节内容整理成平台课程表 data/courses.json。

三件事：
  1. 读出 AI Master 前端导出的 10 章 JSON（frontend/data/chapter_NN.json），
     清洗成平台用的章节结构（补上阶段、难度、时长、标签）。
  2. 按"真实大模型学习路线"重新排布成 4 个阶段，把智能体章节提到阶段二。
  3. 写出 4 个新增章节的**大纲规格**（NEW_CHAPTERS），交给
     tools/draft_new_chapters.py 用大模型扩写成正文。

之所以把"排序 + 大纲"独立成一个脚本而不是手改 JSON：课程表是后面题库、
路线图、RAG 索引共同的输入，重新生成一次就能保证四者不会互相漂移。
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AI_MASTER_DATA = os.path.join(os.path.dirname(ROOT), 'frontend', 'data')
OUT = os.path.join(ROOT, 'data', 'courses.json')

STAGES = {
    1: ('阶段一 · 认知筑基', '看懂大模型是什么、怎么运转的', '#7ee1ff'),
    2: ('阶段二 · 智能体内核', '把模型变成会规划、会用工具的智能体', '#e2b4ff'),
    3: ('阶段三 · 知识增强与调优', '让模型接上私有知识、跑得更快更省', '#8ff0c8'),
    4: ('阶段四 · 工程落地', '把方案做成能上线的产品，并拿下认证', '#ffd28a'),
}

# ── 章节排布 ────────────────────────────────────────────
# (新章节号, 来源文件或 None, 新标题, 图标, 阶段, 是否凸显, 难度, 预估小时, 描述, 标签)
CHAPTERS = [
    (1, 'chapter_01', '大模型基础原理', '🌌', 1, False, '入门', 3.0,
     '从「预测下一个词」讲透大模型的本质：能力边界、Token 化、预训练与对齐、缩放定律。',
     ['LLM', 'Tokenization', 'Scaling Laws', 'RLHF']),
    (2, 'chapter_02', 'Transformer 架构详解', '⚛️', 1, False, '核心', 3.5,
     '自注意力、多头、位置编码、KV-Cache 与 FlashAttention：理解每一个 token 的成本从哪来。',
     ['Attention', 'KV-Cache', 'FlashAttention', 'RoPE']),
    (3, 'chapter_03', '提示词工程基础', '🧩', 1, False, '入门', 2.5,
     '从「说话的艺术」升级为可复现的工程：结构化提示、Few-shot、约束与输出控制。',
     ['Prompt', 'Few-shot', '约束工程']),
    (4, None, '智能体原理与架构', '🛰️', 2, True, '核心', 4.0,
     '智能体 = 模型 + 循环 + 工具 + 记忆。讲清 ReAct、规划、工具调用协议与失败模式。',
     ['Agent', 'ReAct', 'Function Calling', 'Memory']),
    (5, 'chapter_04', '智能体框架与工程化', '🔧', 2, True, '核心', 3.5,
     'LangChain / LlamaIndex / 多 Agent 协作与生产级选型：把智能体从脚本变成系统。',
     ['LangChain', 'LlamaIndex', 'Multi-Agent', '选型']),
    (6, None, '智能体实战与评测', '🧪', 2, True, '实战', 3.0,
     '把智能体做成可交付的东西：工具编排、评测集、失败诊断，以及主流 Agent 产品实测。',
     ['Agent 评测', '可观测', 'Trae', 'ZCode']),
    (7, 'chapter_06', 'RAG 技术详解', '📚', 3, False, '核心', 4.0,
     '切分、向量检索、重排、评估与高阶范式：给模型接上你自己的知识库。',
     ['RAG', 'Embedding', 'Rerank', '评估']),
    (8, None, '模型微调与对齐', '🎛️', 3, False, '进阶', 3.5,
     'SFT / LoRA / QLoRA / DPO：什么时候该微调、数据怎么造、效果怎么验。',
     ['SFT', 'LoRA', 'DPO', '数据工程']),
    (9, None, '推理部署与成本优化', '🚀', 3, False, '进阶', 3.0,
     '量化、vLLM、显存估算、并发与成本：让模型在生产环境跑得又快又便宜。',
     ['量化', 'vLLM', '显存', '成本']),
    (10, 'chapter_05', 'Claude Code 与 AI 编程工具链', '⌨️', 4, False, '实战', 3.0,
     'MCP、Hooks、Skills 与项目实战：把命令行智能体真正用进日常开发。',
     ['Claude Code', 'MCP', 'Hooks', 'Skills']),
    (11, 'chapter_09', '大模型应用实战', '🏗️', 4, False, '实战', 3.0,
     '从需求到上线：RAG 系统、Agent 开发、多工具编排、评估驱动与成本优化。',
     ['工程化', 'EDD', '生产部署']),
    (12, 'chapter_07', '阿里云 ACP 认证要点（上）', '📘', 4, False, '认证', 2.5,
     'ACP 考点梳理：灵积模型服务、百炼平台、PAI 全流程与模型评估指标。',
     ['ACP', 'DashScope', 'PAI']),
    (13, 'chapter_08', '阿里云 ACP 认证要点（下）', '📗', 4, False, '认证', 2.5,
     '部署优化、量化原理、向量数据库、安全合规与安全评测方法论。',
     ['ACP', '量化', '安全合规']),
]


def clean_html(html):
    """清掉导出文件里混进来的换行转义和空标签，让正文保持一段可读的 HTML。"""
    text = html or ''
    text = text.replace('\\n', '\n')
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def plain_len(html):
    return len(re.sub('<[^>]+>', '', html or ''))


def load_source(name):
    path = os.path.join(AI_MASTER_DATA, name + '.json')
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def convert_kp(kp, index):
    minutes = max(12, min(40, round(plain_len(kp.get('content', '')) / 45)))
    return {
        'index': index,
        'title': kp.get('title', '').strip(),
        'content': clean_html(kp.get('content', '')),
        'minutes': minutes,
    }


def convert_exercise(ex, index, chapter_id):
    """把 AI Master 原有的章节选择题转成题库条目（保留原答案与解析）。"""
    options = [str(o).strip() for o in (ex.get('options') or [])]
    try:
        answer = int(ex.get('answer', 0))
    except (TypeError, ValueError):
        answer = 0
    if not options or not (0 <= answer < len(options)):
        return None
    # 选项里已经带了 "A. " 前缀，统一剥掉，前端自己编号
    options = [re.sub(r'^[A-Da-d][.、)]\s*', '', o) for o in options]
    return {
        'id': 'legacy-%02d-%02d' % (chapter_id, index + 1),
        'type': 'choice',
        'chapter_id': chapter_id,
        'kp_index': None,
        'title': '第 %d 章 · 自测 %d' % (chapter_id, index + 1),
        'difficulty': 1,
        'statement': ex.get('question', '').strip(),
        'options': options,
        'answer': answer,
        'explanation': ex.get('explanation', '') or '',
        'source': 'legacy',
    }


def legacy_chapter(src, chapter_id):
    """AI Master 老章节：把 exercises 抽出来单独交给题库，正文只留知识点。"""
    exercises = []
    for i, ex in enumerate(src.get('exercises') or []):
        item = convert_exercise(ex, i, chapter_id)
        if item:
            exercises.append(item)
    return exercises


# ── 新章节大纲 ──────────────────────────────────────────
# 每个知识点给三段：讲什么（points）、要给出什么例子（example）、学完能做什么（outcome）。
# draft_new_chapters.py 按这份规格扩写正文，所以这里写得越具体，生成的内容越不跑偏。
NEW_CHAPTERS = {
    4: {
        'title': '智能体原理与架构',
        'kps': [
            {'title': '什么是 AI 智能体：从补全到行动',
             'points': ['智能体的定义：在环境中感知—决策—行动—观察的闭环',
                        '与「一次性问答」的本质差别：有目标、有中间状态、能调用外部能力',
                        '智能体四要素：模型（大脑）、工具（手脚）、记忆（上下文与外部存储）、循环（控制流）',
                        '自主性光谱：从固定 workflow 到完全自主 agent，以及什么时候该用哪一种'],
             'example': '同一句需求「帮我把这个月的销售数据做成周报」分别用单次提示、workflow、agent 三种方式实现，对比可控性与成本',
             'outcome': '能判断一个需求该做成 workflow 还是 agent'},
            {'title': 'ReAct：思考与行动交替的经典范式',
             'points': ['ReAct 论文的核心：把 Thought / Action / Observation 交替写进上下文',
                        '为什么「先想再动手」比直接给答案准确率高：错误能被观察结果纠正',
                        '一次完整的 ReAct 轨迹逐行拆解（含工具返回值如何回灌）',
                        'ReAct 的边界：步数膨胀、死循环、工具噪声'],
             'example': '用 ReAct 轨迹解决「去年营收最高的季度是哪个」需要查两次数据的多跳问题',
             'outcome': '能手写 ReAct 提示词并读懂一条失败轨迹'},
            {'title': '规划与任务分解',
             'points': ['Plan-and-Execute：先出计划再逐步执行，与 ReAct 的交错式对比',
                        '任务分解的常见结构：顺序链、并行扇出、条件分支、循环直到满足条件',
                        '反思与自我修正（Reflexion）：把失败原因写回记忆再重试',
                        '什么时候不该让模型规划：确定性流程、高风险操作用代码编排更稳'],
             'example': '把「给一个开源项目写完整 README」分解成探查—大纲—撰写—校验四步子任务',
             'outcome': '能为一个复杂任务画出子任务依赖图并选对编排方式'},
            {'title': '工具调用协议：Function Calling 到 MCP',
             'points': ['Function Calling 机制：模型输出的不是自然语言而是结构化调用意图',
                        '工具描述的三要素：名字、参数 schema、何时该用的说明，以及描述质量对成功率的影响',
                        '错误处理：参数校验、超时、重试、把失败信息回灌给模型',
                        'MCP（Model Context Protocol）解决了什么：把工具从「写死在提示词里」变成可插拔的服务'],
             'example': '定义一个「查询天气」工具，对比模糊描述与精确 schema 两种写法下的调用成功率',
             'outcome': '能写出一个让模型稳定调用的工具定义并处理其失败'},
            {'title': '记忆系统：上下文、摘要与向量记忆',
             'points': ['短期记忆：上下文窗口内的对话历史，以及「迷失在中间」的影响',
                        '上下文压缩：滚动摘要、要点抽取、关键状态外置',
                        '长期记忆：向量库检索式记忆与结构化记忆（用户画像、事实表）的取舍',
                        '记忆写入策略：什么时候该记、记什么、如何避免把错误结论记成事实'],
             'example': '一个跨 30 轮对话的客服 agent：哪些信息进摘要、哪些进向量库、哪些直接丢弃',
             'outcome': '能为一个长会话场景设计出不会丢关键信息的记忆方案'},
            {'title': '智能体的失败模式与护栏',
             'points': ['典型失败：目标漂移、工具误用、幻觉式行动、无限循环、上下文爆炸',
                        '护栏手段：最大步数、预算与超时、危险操作二次确认、输出结构校验',
                        '人在回路：什么时候必须停下来问人',
                        '可观测性：把每步的思考、调用、参数、返回值落成可回放日志'],
             'example': '一条真实失败轨迹的复盘：agent 连续 7 次调用同一个失败的工具，如何用护栏拦住',
             'outcome': '能说出至少 5 种护栏并在代码里落地 3 种'},
        ],
    },
    6: {
        'title': '智能体实战与评测',
        'kps': [
            {'title': '从 Demo 到生产：智能体工程清单',
             'points': ['工程化清单：提示词版本管理、工具注册表、状态持久化、幂等与重试',
                        '状态机式编排 vs 自由循环：为什么生产系统更喜欢有边界的图结构',
                        '灰度与回滚：提示词与模型是配置，不是代码，但同样需要版本与回滚',
                        '成本与延迟预算：一次 agent 调用的 token 账怎么算'],
             'example': '一个上线前检查表，逐项对照一个真实 agent 应用找缺口',
             'outcome': '能列出一个 agent 应用上线前必须过的检查项'},
            {'title': '智能体评测：指标、评测集与 A/B',
             'points': ['评测三个层次：单步能力（工具选对没）、轨迹质量（路径是否合理）、最终结果（任务成没成）',
                        '结果评估器：精确匹配、规则校验、模型裁判（LLM-as-Judge）与它们的偏差',
                        '构造评测集：从真实失败案例回流，比造数据集更有价值',
                        '离线评测 → 灰度 A/B → 线上监控的完整闭环'],
             'example': '为「订机票 agent」设计 12 条评测用例，覆盖正常、边界与对抗场景',
             'outcome': '能独立为一个 agent 写出可执行的评测集'},
            {'title': '可观测与调试：把黑盒拆开看',
             'points': ['一条 trace 该记录什么：输入、模型输出、工具调用、耗时、token、错误',
                        '常见故障定位路径：先从工具返回值看起，再看提示词，最后怀疑模型',
                        '回归测试：把线上每次翻车固化成一个用例',
                        '日志脱敏：不要把用户隐私与密钥写进 trace'],
             'example': '给出一段带 trace 的失败日志，定位到是工具 schema 描述歧义导致的误调用',
             'outcome': '能按固定路径定位 agent 失败原因'},
            {'title': '多智能体协作实战',
             'points': ['角色分工模式：规划者 / 执行者 / 评审者的三体结构',
                        '通信方式对比：共享黑板、消息传递、层级汇报的适用场景',
                        '什么时候多智能体反而更差：成本翻倍、责任不清、互相甩锅',
                        '用一份明确契约（输入输出格式）替代松散的自然语言协作'],
             'example': '「写一篇技术调研报告」的多智能体流水线：检索者、撰写者、事实核查者',
             'outcome': '能设计一个角色边界清晰的多智能体方案'},
            {'title': '主流智能体产品实测：Trae / ZCode / WorkBuddy',
             'points': ['Trae：面向开发场景的 AI IDE，智能体如何参与改代码与跑命令',
                        'ZCode：命令行与 IDE 里的编码智能体，权限模型与工作区约束',
                        'WorkBuddy：面向办公协作的智能助手，任务分解与工具集差异',
                        '横向对比维度：工具生态、上下文管理、权限与安全、可扩展性'],
             'example': '用同一道真实任务分别交给三个产品，记录各自失败点',
             'outcome': '能按场景选型并说清取舍理由'},
            {'title': '智能体安全与权限边界',
             'points': ['提示词注入：外部内容里藏指令，如何识别与隔离',
                        '最小权限原则：给 agent 的工具权限应该比人小还是大',
                        '危险动作清单：删除、付款、发消息、改生产数据必须二次确认',
                        '审计：谁在什么时候让 agent 做了什么，必须可追溯'],
             'example': '一个网页内容注入让 agent 试图外发数据的案例与拦截方案',
             'outcome': '能为一个 agent 写出权限清单与确认策略'},
        ],
    },
    8: {
        'title': '模型微调与对齐',
        'kps': [
            {'title': '什么时候才该微调',
             'points': ['决策顺序：提示词 → RAG → 微调，为什么这个顺序不能倒',
                        '微调真正擅长的事：固定风格、固定格式、领域术语、降低 token 成本',
                        '微调不擅长的事：注入大量事实知识、频繁变更的信息',
                        '成本核算：数据标注、训练算力、迭代周期的真实开销'],
             'example': '三个需求（要私有知识 / 要固定 JSON 格式 / 要特定文风）分别该选哪条路',
             'outcome': '能用三问判断一个需求该不该微调'},
            {'title': 'SFT 监督微调：数据决定上限',
             'points': ['SFT 的数据格式：指令—回答对，以及多轮对话样本的组织方式',
                        '数据质量 > 数据数量：少量高质量样本往往胜过万条噪声',
                        '数据构造来源：业务日志筛选、模型蒸馏、人工精修',
                        '训练超参的直觉：学习率、轮数、过拟合的表现'],
             'example': '把 500 条客服日志清洗成可训练的 SFT 数据集',
             'outcome': '能独立准备一份能训出效果的 SFT 数据集'},
            {'title': 'LoRA 与 QLoRA：低成本微调',
             'points': ['LoRA 的核心：冻结原权重，只训练低秩增量矩阵',
                        '关键参数：rank、alpha、target_modules 怎么选',
                        'QLoRA：4bit 量化基座 + LoRA，把微调门槛降到单卡',
                        '合并与部署：LoRA 权重如何合并进基座、如何多适配器切换'],
             'example': '显存估算：7B 模型全参微调 vs LoRA vs QLoRA 的显存差距',
             'outcome': '能算出一张卡能微调多大模型'},
            {'title': '对齐：DPO 与偏好优化',
             'points': ['从 RLHF 到 DPO：省掉奖励模型的直觉解释',
                        '偏好数据：chosen / rejected 对怎么收集最有价值',
                        'DPO 的坑：偏好数据分布偏移、过度优化导致输出退化',
                        '安全对齐：拒答边界与「有用性 vs 安全性」的权衡'],
             'example': '同一问题下的两组回答，标注成偏好对并说明标注理由',
             'outcome': '能判断一个场景该用 SFT 还是 DPO'},
            {'title': '微调效果评估与回归',
             'points': ['评估集必须包含：目标任务集、通用能力回归集、安全测试集',
                        '过拟合的识别：训练损失下降但评测集掉分',
                        '对比实验设计：基座 / 提示词 / RAG / 微调 四条基线一起比',
                        '上线后监控：输出分布漂移与用户反馈回流'],
             'example': '一次微调后通用问答能力下降 8 分，如何定位是数据太窄',
             'outcome': '能为一次微调设计完整的评估方案'},
            {'title': '蒸馏与合成数据',
             'points': ['知识蒸馏：强模型生成数据训小模型的完整流程',
                        '合成数据的质量守门：为什么要人工抽检与去重',
                        '用模型造数据的常见坑：自我强化偏差、格式坍缩',
                        '成本对比：蒸馏一个小模型 vs 一直调用大模型 API'],
             'example': '用大模型生成 2000 条领域问答，抽检 50 条后的修正记录',
             'outcome': '能设计一条合成数据流水线并说清风险'},
        ],
    },
    9: {
        'title': '推理部署与成本优化',
        'kps': [
            {'title': '推理性能指标：延迟、吞吐与成本',
             'points': ['TTFT（首字延迟）、TPOT（每 token 延迟）、吞吐（tokens/s）三者的关系',
                        '为什么流式输出对体验的影响远大于总耗时',
                        '预填充（prefill）与解码（decode）两个阶段的瓶颈不同',
                        '成本公式：输入 token、输出 token、缓存命中分别怎么计价'],
             'example': '同一模型三种并发下的延迟/吞吐曲线读数',
             'outcome': '能读懂一份推理性能报告并指出瓶颈'},
            {'title': '量化：用更少的比特跑同样的模型',
             'points': ['量化做什么：把权重从 FP16 压到 INT8 / INT4',
                        '常见方案：GPTQ、AWQ、GGUF 的差异与适用场景',
                        '量化代价：精度损失出现在哪些任务上（长链推理最敏感）',
                        'KV-Cache 量化：长上下文场景的显存救命手段'],
             'example': '7B 模型 FP16 / INT8 / INT4 的显存与质量对比表',
             'outcome': '能为一个部署场景选对量化方案'},
            {'title': '高效推理引擎：vLLM 与批处理',
             'points': ['PagedAttention 的核心思想：像操作系统管理内存一样管理 KV-Cache',
                        '连续批处理（continuous batching）：让不同长度的请求共享一次前向',
                        '投机解码：用小模型猜、大模型验，换 2-3 倍加速',
                        '什么时候该上自建推理：调用量、延迟要求、数据合规三条线'],
             'example': '同一张卡上 vLLM 与朴素 transformers 的吞吐对比',
             'outcome': '能判断自建推理是否划算'},
            {'title': '显存估算与容量规划',
             'points': ['显存的四块占用：权重、KV-Cache、激活、框架开销',
                        '手算公式：权重显存 ≈ 参数量 × 字节数，KV-Cache 与 batch/长度成正比',
                        '并发估算：给定显存能同时服务多少路请求',
                        '扩缩容：突发流量的排队策略与降级方案'],
             'example': '给定 24G 显卡与 7B-INT4 模型，估算最大并发与最长上下文',
             'outcome': '能独立完成一次部署容量估算'},
            {'title': '提示词缓存与请求优化',
             'points': ['前缀缓存：为什么把固定内容放前面能把 TTFT 砍掉一半',
                        '语义缓存：相似问题直接命中历史答案的边界与风险',
                        '模型路由：简单问题走小模型、难题才走大模型',
                        '输出约束：限制 max_tokens、结构化输出减少无效 token'],
             'example': '一个 FAQ 场景接入缓存前后：token 成本与首字延迟的实测对比',
             'outcome': '能在应用层落地至少两种降本手段'},
            {'title': '生产监控与稳定性',
             'points': ['必须监控的四类指标：可用性、延迟、成本、质量',
                        '降级策略：主模型不可用时怎么切换、怎么保证不返回错误答案',
                        '灰度发布：模型或提示词换版如何小流量验证',
                        '事故复盘：从「用户说答得不对」到定位到具体版本'],
             'example': '一次供应商限流导致的全站降级演练',
             'outcome': '能为一套 LLM 应用写出监控与降级预案'},
        ],
    },
}


def main():
    courses = []
    bank_from_legacy = []
    for cid, src_name, title, icon, stage, highlight, level, hours, desc, tags in CHAPTERS:
        if src_name:
            src = load_source(src_name)
            kps = [convert_kp(kp, i) for i, kp in enumerate(src.get('knowledge_points') or [])]
            mindmap = src.get('mindmap') or ''
            legacy = legacy_chapter(src, cid)
            bank_from_legacy.extend(legacy)
        else:
            spec = NEW_CHAPTERS[cid]
            kps = [{'index': i, 'title': item['title'], 'content': '', 'minutes': 25}
                   for i, item in enumerate(spec['kps'])]
            mindmap = ''
            legacy = []
        courses.append({
            'id': cid,
            'title': title,
            'icon': icon,
            'stage': STAGES[stage][0],
            'stage_id': stage,
            'stage_goal': STAGES[stage][1],
            'stage_color': STAGES[stage][2],
            'highlight': bool(highlight),
            'level': level,
            'hours': hours,
            'description': desc,
            'tags': tags,
            'knowledge_points': kps,
            'legacy_questions': legacy,
            'mindmap': mindmap,
            'has_content': all(bool(kp['content']) for kp in kps),
        })

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(courses, fh, ensure_ascii=False, indent=1)

    pending = [c['title'] for c in courses if not c['has_content']]
    print('[courses] wrote %s' % OUT)
    print('[courses] chapters=%d kps=%d legacy_questions=%d'
          % (len(courses), sum(len(c['knowledge_points']) for c in courses), len(bank_from_legacy)))
    if pending:
        print('[courses] pending content: ' + ' | '.join(pending))
    return 0


if __name__ == '__main__':
    sys.exit(main())
