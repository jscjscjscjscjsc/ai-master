"""Vibe Coding 星云工坊：独立部署的创意发散与开源项目发现站。"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=str(ROOT / "static"), static_url_path="")


def load_local_env():
    """Load this project's .env without adding a runtime dependency."""
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_local_env()


def request_json(url, *, method="GET", body=None, headers=None, timeout=15):
    request_headers = {"User-Agent": "Vibe-Coding-Starlab/1.0", **(headers or {})}
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=payload, headers=request_headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def tidy_text(value, limit=1200):
    return re.sub(r"\s+", " ", str(value or "").strip())[:limit]


DISCOVERY_PROMPT = """你是 Vibe Coding 智能体中的资深产品经理。你的任务不是泛泛给建议，而是从用户的模糊想法里识别真正的产品机会与约束。
先在内部认真推理，再只返回合法 JSON（不要 Markdown）。不要把用户想法机械改写；明确指出最值得验证的假设。
JSON 必须包含：product_name、core_promise、target_user、trigger_scenario、success_signal、non_goals（字符串数组）、
key_decisions（对象数组，每项含 decision、reason、tradeoff）、research_queries（3 个精确英文 GitHub 搜索词）。
所有内容使用中文，且以一个小型可部署网页项目为边界。"""

ARCHITECT_PROMPT = """你是 Vibe Coding 智能体中的技术产品负责人。基于产品经理诊断与 GitHub 候选项目，模拟一次真实、可执行的 MVP 实施规划。
先在内部审视输入，避免空泛模板；只返回合法 JSON（不要 Markdown）。不要承诺你没有验证过的能力；GitHub 候选仅是参考，必须说明应借鉴什么。
JSON 必须包含：route_title、summary、first_session_goal、architecture（对象数组，每项含 layer、choice、why）、
build_path（5 到 7 项数组，每项含 stage、purpose、deliverable、estimated_time、tasks；tasks 是对象数组且每项含 action、why、artifact；另含 validation、risk）、
user_journey（4 项数组，每项含 step、user_action、product_response）、open_source_notes（对象数组，每项含 project、use_for、caution）、
next_questions（最多 3 个字符串）。所有内容使用中文。estimated_time 必须是具体时长，如“45 分钟”或“半天”。"""


def call_model(system_prompt, user_prompt, max_tokens, model_config=None):
    model_config = model_config or {}
    api_key = tidy_text(model_config.get("api_key"), 300) or os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("未配置模型密钥。请点击“模型连接”输入 API Key。")
    model = tidy_text(model_config.get("model"), 100) or os.getenv("VIBE_MODEL", "deepseek-chat")
    payload = {
        "model": model,
        "temperature": 0.8,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    result = request_json(
        "https://api.deepseek.com/v1/chat/completions",
        method="POST",
        body=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key},
    )
    content = result["choices"][0]["message"]["content"]
    return json.loads(content)


def github_search(queries):
    token = os.getenv("GITHUB_TOKEN", "").strip()
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    projects, seen = [], set()
    for query in queries[:3]:
        encoded = urllib.parse.urlencode({"q": tidy_text(query, 100), "sort": "stars", "order": "desc", "per_page": 3})
        try:
            data = request_json("https://api.github.com/search/repositories?" + encoded, headers=headers)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
            continue
        for item in data.get("items", []):
            if item["full_name"] in seen:
                continue
            seen.add(item["full_name"])
            projects.append({
                "name": item["full_name"],
                "description": item.get("description") or "暂无项目简介",
                "url": item["html_url"],
                "stars": item.get("stargazers_count", 0),
                "language": item.get("language") or "未标注",
                "query": query,
            })
            if len(projects) == 6:
                return projects
    return projects


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/api/discover")
def discover():
    data = request.get_json(silent=True) or {}
    idea = tidy_text(data.get("idea"))
    model_config = data.get("model_config") or {}
    if not isinstance(model_config, dict):
        return jsonify({"success": False, "message": "模型连接配置格式无效。"}), 400
    if len(idea) < 8:
        return jsonify({"success": False, "message": "请至少用 8 个字描述你的想法，例如：帮大学生把零碎笔记变成复习挑战。"}), 400
    try:
        discovery = call_model(DISCOVERY_PROMPT, "用户的模糊想法是：" + idea, 1500, model_config)
        projects = github_search(discovery.get("research_queries", []))
        project_context = [{key: project[key] for key in ("name", "description", "url", "stars", "language")} for project in projects]
        plan_prompt = "产品经理诊断：\n" + json.dumps(discovery, ensure_ascii=False) + "\n\nGitHub 候选项目：\n" + json.dumps(project_context, ensure_ascii=False)
        roadmap = call_model(ARCHITECT_PROMPT, plan_prompt, 3400, model_config)
        return jsonify({"success": True, "idea": idea, "discovery": discovery, "roadmap": roadmap, "projects": projects})
    except RuntimeError as error:
        return jsonify({"success": False, "message": str(error)}), 503
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return jsonify({"success": False, "message": "智能体或搜索服务暂时不可达，请稍后重试。"}), 502
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return jsonify({"success": False, "message": "智能体返回的规划格式异常，请重新发射。"}), 502


@app.get("/health")
def health():
    return jsonify({"status": "ok", "ai_configured": bool(os.getenv("DEEPSEEK_API_KEY")), "github_token_configured": bool(os.getenv("GITHUB_TOKEN"))})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5050")), debug=True)
