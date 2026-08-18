"""Generate the no-backend AI Master frontend demo from curated course data.

Run after updating frontend/data and frontend/static. The script does not read
users.json, license databases, logs, API keys, or any server configuration.
"""
from __future__ import annotations

import html
import json
import posixpath
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
DATA = FRONTEND / "data"


def page_url(target: str, source: str) -> str:
    """Resolve a site route relative to a generated page.

    GitHub Pages publishes this repository below ``/ai-master/`` while local
    preview serves ``frontend`` at ``/``. Relative URLs work in both places.
    """
    if not target.startswith("/") or target.startswith("//"):
        return target
    clean = target.lstrip("/")
    source_dir = posixpath.dirname(source.replace("\\", "/")) or "."
    if not clean:
        return "./"
    resolved = posixpath.relpath(clean, source_dir)
    if target.endswith("/") and not resolved.endswith("/"):
        resolved += "/"
    return resolved


def load(name: str):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def write(relative: str, content: str):
    path = FRONTEND / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.strip() + "\n", encoding="utf-8")


def target_for(chapter_id: int) -> str:
    special = {
        1: "/static/llm_intro.html",
        2: "/static/transformer_cg.html",
        3: "/static/prompt_cg_starlab/index.html",
        4: "/static/agentic_cg/index.html",
        5: "/static/claude_cg/index.html",
        6: "/static/rag_cg/index.html",
    }
    return special.get(chapter_id, f"/chapter/{chapter_id}/")


def nav(source: str):
    dashboard = page_url("/dashboard/", source)
    stars = page_url("/knowledge-stars/", source)
    odyssey = page_url("/static/ai_odyssey.html", source)
    coach = page_url("/static/interview.html", source)
    return f'''<nav class="demo-nav"><a class="demo-brand" href="{dashboard}"><i></i><span>AI MASTER <em>/ FRONTEND EDITION</em></span></a><div class="demo-nav-links"><a href="{stars}">知识星海</a><a href="{odyssey}">沉浸远征</a><a href="{coach}">学习教练</a></div></nav>'''


def shell_css():
    return r'''
:root{--bg:#030611;--ink:#edf5ff;--muted:#8d9cbd;--cyan:#72f6e4;--violet:#a99bff;--line:rgba(177,195,255,.18);--panel:rgba(8,13,34,.72);--mono:"Cascadia Mono",Consolas,monospace;--sans:"Segoe UI","Microsoft YaHei",system-ui,sans-serif}*{box-sizing:border-box}html{scroll-behavior:smooth}body{min-height:100vh;margin:0;background:radial-gradient(ellipse at 68% -15%,#172656 0,#080d20 35%,var(--bg) 70%);color:var(--ink);font-family:var(--sans)}a{color:inherit;text-decoration:none}.demo-nav{position:sticky;z-index:30;top:0;display:flex;height:72px;align-items:center;justify-content:space-between;padding:0 clamp(20px,5vw,80px);border-bottom:1px solid var(--line);background:#030611d9;backdrop-filter:blur(16px)}.demo-brand{display:flex;gap:11px;align-items:center;font:700 10px var(--mono);letter-spacing:.14em}.demo-brand i{position:relative;width:22px;height:22px;border:1px solid var(--cyan);border-radius:50%;box-shadow:0 0 17px #72f6e477}.demo-brand i:after{position:absolute;top:7px;left:7px;width:6px;height:6px;border-radius:50%;background:var(--cyan);box-shadow:0 0 10px var(--cyan);content:""}.demo-brand em{color:#7483a6;font-style:normal}.demo-nav-links{display:flex;gap:20px;color:#a9b6d0;font-size:11px}.demo-nav-links a:hover{color:var(--cyan)}.demo-page{width:min(1320px,calc(100% - 48px));margin:auto}.kicker{display:flex;gap:10px;align-items:center;margin:0;color:var(--cyan);font:9px var(--mono);letter-spacing:.18em}.kicker:before{width:36px;height:1px;background:var(--cyan);box-shadow:0 0 9px var(--cyan);content:""}.btn{display:inline-flex;gap:14px;min-height:46px;align-items:center;justify-content:space-between;padding:0 17px;border:1px solid #72f6e477;border-radius:5px;background:#72f6e414;color:#e8fffb;font-size:12px;font-weight:700;transition:.2s}.btn:hover{transform:translateY(-3px);background:#72f6e426;box-shadow:0 15px 32px #72f6e422}.btn-primary{border:0;background:linear-gradient(110deg,#e2ddff,#aaa0ff 55%,#72f6e4);color:#071020}.footer{display:flex;gap:14px;align-items:center;padding:36px 0;color:#6f7c9b;font:8px var(--mono);letter-spacing:.1em}.footer i{width:4px;height:4px;border-radius:50%;background:var(--cyan);box-shadow:0 0 8px var(--cyan)}.notice{padding:13px 15px;border-left:2px solid var(--cyan);background:#72f6e40d;color:#b2c0d9;font-size:12px;line-height:1.7}.notice strong{color:#dffefa}@media(max-width:720px){.demo-nav{height:62px;padding:0 17px}.demo-brand{font-size:8px}.demo-nav-links{gap:12px;font-size:9px}.demo-page{width:calc(100% - 32px)}}
'''


def dashboard_css():
    return r'''
.dash-space{position:fixed;z-index:-1;inset:0;overflow:hidden;pointer-events:none}.dash-space:before,.dash-space:after{position:absolute;width:68vw;aspect-ratio:1;border-radius:50%;filter:blur(105px);opacity:.18;content:""}.dash-space:before{top:-36vw;left:-30vw;background:#2d5bbb}.dash-space:after{right:-35vw;bottom:-43vw;background:#7045ac}.hero{position:relative;display:grid;grid-template-columns:1.05fr .95fr;min-height:630px;align-items:center;gap:42px}.hero h1{margin:25px 0 0;font-size:clamp(48px,6.1vw,88px);font-weight:500;line-height:1.04;letter-spacing:-.07em}.hero h1 em{color:#afa4ff;font-style:normal;text-shadow:0 0 44px #a995ff44}.hero-copy>p:not(.kicker){max-width:570px;margin:28px 0;color:#a6b4d0;font-size:14px;line-height:1.9}.hero-actions{display:flex;gap:14px;flex-wrap:wrap;margin-top:32px}.orbital{position:relative;width:min(570px,44vw);aspect-ratio:1;justify-self:end;perspective:900px}.ring{position:absolute;inset:10%;border:1px solid #a99bff55;border-radius:50%;transform:rotateX(66deg) rotateZ(var(--r));animation:orbit var(--d) linear infinite}.ring:after{position:absolute;top:50%;left:-4px;width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 15px var(--cyan);content:""}.r1{--r:15deg;--d:16s}.r2{inset:22%;--r:94deg;--d:12s;animation-direction:reverse}.r3{inset:34%;--r:144deg;--d:9s}.planet{position:absolute;inset:34%;display:grid;place-items:center;border:1px solid #e8e6ff;border-radius:50%;background:radial-gradient(circle at 34% 27%,#fff,#b4a9ff 12%,#574caf 38%,#1c2455 63%,#070b20 78%);box-shadow:0 0 72px #8574ff88,inset -20px -22px 32px #030713aa;text-align:center;animation:breathe 4s ease-in-out infinite}.planet strong{font:700 clamp(32px,4vw,56px) var(--mono)}.planet span{margin-top:5px;color:#d1ceff;font:8px var(--mono);letter-spacing:.14em}.metric{position:absolute;display:flex;gap:9px;align-items:center;color:#a2afcb;font:8px var(--mono)}.metric i{width:8px;height:8px;border:2px solid #dffeff;border-radius:50%;background:var(--cyan);box-shadow:0 0 14px var(--cyan)}.m1{top:15%;left:20%}.m2{top:28%;right:1%}.m3{right:14%;bottom:15%}.systems{padding:62px 0 82px;border-top:1px solid var(--line)}.systems-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.systems-head p{margin:0;color:var(--cyan);font:8px var(--mono);letter-spacing:.18em}.systems-head span{color:#7583a2;font:8px var(--mono)}.dock{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-left:1px solid var(--line)}.tool{display:grid;grid-template-columns:38px 1fr auto;gap:13px;align-items:center;min-height:116px;padding:16px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:linear-gradient(115deg,#0b1129d9,#060a1cd9);transition:.2s}.tool:hover{transform:translateY(-4px);background:#15224bd9;box-shadow:0 16px 38px #0005}.tool-icon{position:relative;width:38px;aspect-ratio:1;border:1px solid #9eaeeb77;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff3,#685fae33)}.tool-icon:before{position:absolute;top:14px;left:14px;width:8px;height:8px;border-radius:50%;background:var(--cyan);box-shadow:0 0 12px var(--cyan);content:""}.tool mark{display:block;width:max-content;max-width:100%;margin-bottom:7px;padding:3px 5px;border:1px solid #72f6e455;background:#72f6e412;color:#8ffcf0;font:7px var(--mono);letter-spacing:.12em}.tool b,.tool small{display:block}.tool b{font-size:17px}.tool small{margin-top:6px;color:#9baccc;font-size:10px}.tool em{color:var(--cyan);font-style:normal}.route{padding:90px 0}.route-head{display:flex;justify-content:space-between;align-items:end;gap:30px;margin-bottom:60px}.route-head h2{margin:12px 0 0;font-size:clamp(36px,4.7vw,66px);font-weight:500;line-height:1.1;letter-spacing:-.06em}.route-head small{color:#7381a1;font:9px var(--mono)}.route-list{position:relative}.route-list:before{position:absolute;top:52px;bottom:54px;left:56px;width:1px;background:linear-gradient(#a99bff,#72f6e4);box-shadow:0 0 12px var(--cyan);content:""}.sector{position:relative;display:grid;grid-template-columns:76px 168px 1fr 150px;gap:24px;align-items:center;min-height:220px;border-top:1px solid #b0c1f022;transition:.2s}.sector:last-child{border-bottom:1px solid #b0c1f022}.sector:hover{background:linear-gradient(90deg,transparent,#6b78d311,transparent)}.sector-index{position:relative;z-index:1;display:grid;place-items:center;color:#9eabd0;font:10px var(--mono)}.sector-index i{display:block;width:12px;height:12px;margin-top:12px;border:2px solid var(--cyan);border-radius:50%;background:var(--cyan);box-shadow:0 0 13px var(--cyan)}.sector-planet{position:relative;width:145px;aspect-ratio:1}.sector-planet:before{position:absolute;inset:20%;border:1px solid #e4e8ff88;border-radius:50%;background:radial-gradient(circle at 32% 27%,#fff,var(--a) 12%,var(--b) 46%,#10152e 73%);box-shadow:inset -16px -19px 24px #020610aa,0 0 34px color-mix(in srgb,var(--a) 35%,transparent);content:""}.sector-planet:after{position:absolute;top:47%;left:4%;width:92%;height:17%;border:1px solid color-mix(in srgb,var(--a) 62%,transparent);border-radius:50%;box-shadow:0 0 9px color-mix(in srgb,var(--a) 22%,transparent);content:"";transform:rotate(-16deg)}.sector:nth-child(3n+1){--a:#74e9db;--b:#294e88}.sector:nth-child(3n+2){--a:#b093ff;--b:#493d93}.sector:nth-child(3n){--a:#f39ac1;--b:#75335e}.sector-copy p{margin:0;color:#a5b3cf;font-size:12px;line-height:1.75}.sector-copy .code{margin-bottom:9px;color:var(--cyan);font:8px var(--mono);letter-spacing:.15em}.sector-copy h3{margin:0 0 10px;font-size:clamp(21px,2.2vw,31px)}.sector-meta{display:flex;gap:9px;align-items:center;margin-top:15px;color:#71809f;font:8px var(--mono)}.sector-meta i{width:3px;height:3px;border-radius:50%;background:#697797}.sector-go{color:#dffefa;font-size:11px;font-weight:700}.sector-go i{margin-left:8px;color:var(--cyan);font-style:normal}@keyframes orbit{to{transform:rotateX(66deg) rotateZ(calc(var(--r) + 360deg))}}@keyframes breathe{50%{transform:scale(1.045);filter:brightness(1.1)}}@media(max-width:900px){.hero{grid-template-columns:1fr;padding-top:70px}.orbital{width:min(570px,80vw);justify-self:center}.dock{grid-template-columns:repeat(2,1fr)}.sector{grid-template-columns:58px 135px 1fr}.sector-go{grid-column:3;margin-top:-28px}.route-list:before{left:43px}}@media(max-width:620px){.hero h1{font-size:clamp(42px,12vw,62px)}.dock{grid-template-columns:1fr}.route-head{display:block}.route-head small{display:block;margin-top:17px}.sector{grid-template-columns:34px 92px 1fr;gap:10px;min-height:190px}.sector-planet{width:92px}.route-list:before{left:17px}.sector-copy h3{font-size:19px}.sector-copy p:not(.code){display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}.sector-go{font-size:10px}.hero-actions{display:grid}.metric{font-size:7px}}
'''


def chapter_css():
    return r'''
.chapter-hero{position:relative;min-height:350px;padding:90px 0 54px;overflow:hidden}.chapter-hero:after{position:absolute;top:20px;right:5%;width:min(42vw,440px);aspect-ratio:1;border:1px solid #a99bff66;border-radius:50%;background:radial-gradient(circle at 34% 26%,#fff,#72f6e4 5%,#7164db 28%,#111842 65%,transparent 70%);box-shadow:0 0 80px #7969ff55;content:""}.chapter-hero h1{position:relative;z-index:1;max-width:720px;margin:18px 0 0;font-size:clamp(40px,5.5vw,76px);font-weight:500;line-height:1.05;letter-spacing:-.06em}.chapter-hero>p{position:relative;z-index:1;max-width:590px;color:#a9b6cf;font-size:14px;line-height:1.9}.knowledge-route{position:relative;max-width:930px;padding-bottom:100px}.knowledge-route:before{position:absolute;top:35px;bottom:105px;left:23px;width:1px;background:linear-gradient(var(--cyan),#a99bff,transparent);content:""}.knowledge{position:relative;display:grid;grid-template-columns:52px 1fr;gap:22px;padding:0 0 28px}.knowledge-node{position:relative;z-index:1;display:grid;width:46px;height:46px;place-items:center;border:1px solid #72f6e488;border-radius:50%;background:#0b1532;color:var(--cyan);font:10px var(--mono);box-shadow:0 0 21px #72f6e422}.knowledge-card{padding:22px;border:1px solid var(--line);border-radius:8px;background:var(--panel);box-shadow:0 16px 48px #0004}.knowledge-card summary{display:flex;gap:15px;align-items:center;cursor:pointer;list-style:none}.knowledge-card summary::-webkit-details-marker{display:none}.knowledge-card h2{margin:0;font-size:clamp(19px,2.3vw,28px)}.knowledge-card summary span{margin-left:auto;color:var(--cyan);font:12px var(--mono)}.knowledge-content{padding-top:17px;color:#bac5da;font-size:13px;line-height:1.85}.knowledge-content pre{padding:12px;overflow:auto;background:#020611;border:1px solid #6674aa44;border-radius:5px;color:#d5eaff;font:11px/1.6 Consolas,monospace;white-space:pre-wrap}.knowledge-content code{color:#8cf8ec}.chapter-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.chapter-actions a{padding:8px 10px;border:1px solid #a99bff55;border-radius:4px;background:#a99bff12;color:#dcd7ff;font-size:10px}.chapter-actions a:hover{border-color:var(--cyan);color:var(--cyan)}@media(max-width:700px){.chapter-hero{padding-top:65px}.chapter-hero:after{right:-20%;width:75vw;opacity:.6}.knowledge{grid-template-columns:42px 1fr;gap:14px}.knowledge-node{width:40px;height:40px}.knowledge-route:before{left:19px}.knowledge-card{padding:17px}.knowledge-card h2{font-size:19px}}
'''


def runtime_js():
    return r'''
(() => {"use strict";const canvas=document.querySelector("#demo-stars");if(!canvas)return;const ctx=canvas.getContext("2d"),reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;let stars=[];function resize(){const r=Math.min(devicePixelRatio||1,1.5);canvas.width=innerWidth*r;canvas.height=innerHeight*r;canvas.style.width=`${innerWidth}px`;canvas.style.height=`${innerHeight}px`;ctx.setTransform(r,0,0,r,0,0);stars=Array.from({length:innerWidth<700?150:320},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight,z:Math.random()*1.2+.2,p:Math.random()*6.28}));}function draw(t){ctx.clearRect(0,0,innerWidth,innerHeight);stars.forEach(s=>{const a=.15+(Math.sin(t*.001+s.p)+1)*.16;ctx.beginPath();ctx.arc(s.x,s.y,s.z,0,Math.PI*2);ctx.fillStyle=`rgba(196,222,255,${a})`;ctx.fill();});if(!reduced)requestAnimationFrame(draw);}addEventListener("resize",resize,{passive:true});resize();requestAnimationFrame(draw);})();
'''


def static_coach_js():
    return r'''
(() => {"use strict";const $=s=>document.querySelector(s);const form=$("#intakeForm"),route=$("#routeView"),intro=$("#coachIntro"),panel=$("#onboardingPanel"),constellation=$("#constellation"),feedback=$("#coachFeedback");let plan=[];function esc(v){const s=document.createElement("span");s.textContent=v||"";return s.innerHTML;}function makePlan(goal){const rag=/rag|检索|私有|向量|知识库/i.test(goal);const agent=/agent|智能体|工作流/i.test(goal);const core=rag?[["大模型基础原理","理解模型与知识边界","/static/llm_intro.html"],["Transformer 架构详解","理解信息如何流动","/static/transformer_cg.html"],["RAG 技术详解","构建检索增强链路","/static/rag_cg/index.html"],["大模型应用实战","设计企业知识库原型","/chapter/9/"]]:agent?[["大模型基础原理","建立模型能力边界","/static/llm_intro.html"],["提示词工程基础","设计可靠上下文","/static/prompt_cg_starlab/index.html"],["驾驭框架与智能体概念","构建工具调用循环","/static/agentic_cg/index.html"],["各类 Agent 教学与测试","完成智能体方案复盘","/chapter/10/"]]:[["大模型基础原理","建立核心概念框架","/static/llm_intro.html"],["Transformer 架构详解","理解模型推理机制","/static/transformer_cg.html"],["提示词工程基础","掌握与模型协作的方法","/static/prompt_cg_starlab/index.html"],["驾驭框架与智能体概念","把知识应用到工作流","/static/agentic_cg/index.html"]];return core.map((x,i)=>({id:i,title:x[0],objective:x[1],url:x[2],status:i?"locked":"current",prompt:`请把「${x[0]}」讲给一位零基础同学：它是什么、为什么需要它、一个真实例子，以及缺少它会怎样。`,minutes:45}));}function render(){const current=plan.find(x=>x.status==="current")||plan[0];$("#missionTitle").textContent="我的 AI 学习远征";$("#coachIntroText").textContent="这是前端演示版的本地学习路线。完整产品会结合账号进度、错题与 AI 教练动态生成。";$("#profileSummary").textContent="路线保存在当前浏览器；克隆源码后无需用户数据即可体验完整导航。";constellation.innerHTML=plan.map((m,i)=>`<button class="milestone ${m.status}" data-id="${m.id}" ${m.status==="locked"?"disabled":""} style="--node-color:${["#72f6e4","#a99bff","#ff9dcc","#ffc978"][i]}"><span class="node">${m.status==="completed"?"✓":String(i+1).padStart(2,"0")}</span><span class="milestone-copy"><p>${m.status==="current"?"CURRENT MISSION":m.status==="completed"?"COMPLETE":"LOCKED"}</p><h3>${esc(m.title)}</h3><span>${esc(m.objective)}</span></span></button>`).join("");$("#routeProgress").textContent=`${plan.filter(x=>x.status==="completed").length} / ${plan.length} 已抵达`;$("#missionName").textContent=current.title;$("#missionObjective").textContent=current.objective;$("#missionTime").textContent=`${current.minutes} MIN`;$("#learnLink").href=current.url;$("#feynmanPrompt").textContent=current.prompt;$("#completionCriteria").textContent="通行标准：讲清定义、因果、案例和边界。";$("#explanationInput").disabled=false;$("#checkExplanation").disabled=false;feedback.hidden=true;}form.addEventListener("submit",e=>{e.preventDefault();const goal=$("#goal").value.trim();if(goal.length<6)return;plan=makePlan(goal);localStorage.setItem("aimaster_frontend_plan",JSON.stringify(plan));intro.style.display="none";panel.style.display="none";route.style.display="grid";render();});$("#checkExplanation").addEventListener("click",()=>{const text=$("#explanationInput").value.trim();if(text.length<30){alert("请先完成一段自己的讲解，再交给教练检验。");return;}const pass=text.length>170&&/(因为|例如|如果|所以)/.test(text);feedback.hidden=false;feedback.innerHTML=`<div class="feedback-head"><p>FRONTEND COACH DIAGNOSIS</p><span class="score-pill">理解度 ${pass?8:6} / 10</span></div><p>${pass?"你的讲解已包含概念、因果和案例，可以推进下一阶段。":"讲解方向正确。请补充“为什么需要它”以及“缺少它会怎样”的因果链。"}</p><div class="micro-lesson">费曼学习的重点不是复述术语，而是把输入、机制与结果的关系讲清楚。</div><p><strong>下一次思考：</strong>如果移除这个机制，系统最先会出现什么问题？</p>${pass?'<button class="advance-button" id="advance">点亮下一颗星球 →</button>':""}`;const btn=$("#advance");if(btn)btn.addEventListener("click",()=>{const i=plan.findIndex(x=>x.status==="current");plan[i].status="completed";if(plan[i+1])plan[i+1].status="current";localStorage.setItem("aimaster_frontend_plan",JSON.stringify(plan));$("#explanationInput").value="";render();});});$("#replanButton").addEventListener("click",()=>{route.style.display="none";panel.style.display="block";intro.style.display="block";});const saved=localStorage.getItem("aimaster_frontend_plan");if(saved){try{plan=JSON.parse(saved);intro.style.display="none";panel.style.display="none";route.style.display="grid";render();}catch{}}})();
'''


def build_dashboard(courses):
    source = "dashboard/index.html"
    tools = [
        ("SYSTEM 01 / KNOWLEDGE", "思维画布", "组织你的知识航线", "/canvas/"),
        ("SYSTEM 02 / ARCHIVE", "术语档案", "浏览知识概念", "/chapter/1/"),
        ("SYSTEM 03 / KNOWLEDGE ATLAS", "步入 3D 星海", "进入可旋转的知识星系与关系网络", "/knowledge-stars/"),
        ("SYSTEM 04 / LEARNING CENTER", "星辰学习中心", "费曼路线、沉浸练习与学习教练", "/learning-center/"),
        ("SYSTEM 05 / LEARNING COACH", "费曼学习教练", "生成本地费曼学习路线", "/static/interview.html"),
        ("SYSTEM 06 / PROLOGUE", "学习序章", "返回主前端入口", "/"),
        ("SYSTEM 07 / ODYSSEY", "沉浸远征", "沿着 3D 航线进入 AI 学习章节", "/static/ai_odyssey.html"),
    ]
    tool_html = "".join(f'<a class="tool" href="{page_url(url, source)}"><i class="tool-icon"></i><span><mark>{code}</mark><b>{title}</b><small>{desc}</small></span><em>↗</em></a>' for code,title,desc,url in tools)
    sector_html = ""
    for course in courses:
        cid = int(course["id"])
        sector_html += f'''<a class="sector" href="{page_url(target_for(cid), source)}"><div class="sector-index"><span>{cid:02d}</span><i></i></div><div class="sector-planet"></div><div class="sector-copy"><p class="code">SECTOR {cid:02d} / AVAILABLE</p><h3>{html.escape(course['title'])}</h3><p>{html.escape(course.get('description',''))}</p><div class="sector-meta"><span>{course.get('knowledge_count',0)} 知识节点</span><i></i><span>{course.get('exercise_count',0)} 训练任务</span></div></div><span class="sector-go">进入星域 <i>→</i></span></a>'''
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Master - 前端演示</title><link rel="stylesheet" href="{page_url('/assets/frontend.css', source)}"><link rel="stylesheet" href="{page_url('/assets/dashboard-demo.css', source)}"></head><body><canvas id="demo-stars" class="dash-space"></canvas>{nav(source)}<main class="demo-page"><section class="hero"><div class="hero-copy"><p class="kicker">FRONTEND LEARNING UNIVERSE / DEMO</p><h1>欢迎归航，探索者。<br><em>下一片星域正在苏醒。</em></h1><p>这是从 AI Master 本地项目导出的前端复现版。星海、章节航线、CG 页面与本地交互均可直接体验；账户、授权、AI 服务和用户数据不包含在本仓库。</p><div class="hero-actions"><a class="btn btn-primary" href="{page_url('/knowledge-stars/', source)}">步入 3D 星海 <i>↗</i></a><a class="btn" href="#route">浏览章节航线 <i>↓</i></a><a class="btn" href="{page_url('/static/ai_odyssey.html', source)}">开启沉浸远征 <i>↗</i></a></div></div><div class="orbital"><i class="ring r1"></i><i class="ring r2"></i><i class="ring r3"></i><div class="planet"><strong>10</strong><span>SECTORS</span></div><p class="metric m1"><i></i>10 星域</p><p class="metric m2"><i></i>57 知识节点</p><p class="metric m3"><i></i>FRONTEND READY</p></div></section><section class="systems"><header class="systems-head"><p>EXPEDITION SYSTEMS</p><span>静态演示模式 / 无用户数据</span></header><div class="dock">{tool_html}</div></section><section id="route" class="route"><header class="route-head"><div><p class="kicker">LEARNING CONSTELLATION</p><h2>十个星域，一条通往<br>智能工程的远征航线。</h2></div><small>所有章节入口均已映射至静态页面</small></header><div class="route-list">{sector_html}</div></section><footer class="footer"><span>AI MASTER / FRONTEND REPRODUCTION EDITION</span><i></i><span>无后端、无账号、无授权数据</span></footer></main><script src="{page_url('/assets/frontend.js', source)}"></script></body></html>'''


def chapter_page(chapter):
    cid = int(chapter["id"])
    source = f"chapter/{cid}/index.html"
    cards = []
    for index, point in enumerate(chapter.get("knowledge_points", []), 1):
        title = html.escape(str(point.get("title", f"知识点 {index}")))
        content = str(point.get("content", "")).replace("\n", "<br>")
        extra = ""
        if cid == 1 and index == 3: extra = f'<a href="{page_url("/static/bpe_game.html", source)}">BPE 分词游戏 ↗</a>'
        if cid == 1 and index == 6: extra += f'<a href="{page_url("/static/llm_training_game.html", source)}">LLM 训练流程模拟 ↗</a>'
        if cid == 2 and index == 1: extra += f'<a href="{page_url("/static/transformer_lab.html", source)}">Transformer 实验室 ↗</a>'
        if cid == 3 and index == 1: extra += f'<a href="{page_url("/static/prompt_cg_starlab/index.html", source)}">提示词工程引导 CG ↗</a>'
        cards.append(f'''<article class="knowledge" id="kp-{index}"><div class="knowledge-node">{index:02d}</div><details class="knowledge-card" {"open" if index == 1 else ""}><summary><h2>{title}</h2><span>EXPLORE +</span></summary><div class="knowledge-content">{content}<div class="chapter-actions">{extra}</div></div></details></article>''')
    ppt = chapter.get("ppt_url", "")
    ppt_link = f'<a class="btn" target="_blank" rel="noreferrer" href="{html.escape(ppt)}">查看本章档案 ↗</a>' if ppt else ""
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Master - {html.escape(chapter['title'])}</title><link rel="stylesheet" href="{page_url('/assets/frontend.css', source)}"><link rel="stylesheet" href="{page_url('/assets/chapter-demo.css', source)}"></head><body><canvas id="demo-stars" class="dash-space"></canvas>{nav(source)}<main class="demo-page"><section class="chapter-hero"><p class="kicker">SECTOR {cid:02d} / KNOWLEDGE EXPEDITION</p><h1>{html.escape(chapter['title'])}</h1><p>{html.escape(chapter.get('description',''))}</p><div class="hero-actions"><a class="btn btn-primary" href="{page_url('/dashboard/', source)}">返回指挥舱 ↗</a>{ppt_link}</div></section><section class="knowledge-route">{''.join(cards)}</section><footer class="footer"><span>AI MASTER / STATIC CHAPTER EDITION</span><i></i><a href="{page_url('/knowledge-stars/', source)}">返回知识星海 ↗</a></footer></main><script src="{page_url('/assets/frontend.js', source)}"></script></body></html>'''


def build_universe(courses, chapters):
    palettes = [["0x6ee7f5","0x2f75c9"],["0xba9aff","0x7148bf"],["0xffce7b","0xc96a39"],["0x75efbd","0x239b77"],["0xff92bf","0xb44c83"],["0x94aeff","0x4b55bc"],["0xf2b0ff","0x9954b8"],["0x84d9ff","0x357fb8"],["0xffaa72","0xb45158"],["0x96f4d5","0x368f9b"]]
    galaxies = []
    for course in courses:
        cid = int(course["id"]); chapter = chapters[cid]
        stars=[]
        for idx, point in enumerate(chapter.get("knowledge_points", [])):
            stars.append({"chapter":cid,"index":idx,"title":point.get("title",f"知识点 {idx+1}"),"desc":re.sub(r"\s+"," ",str(point.get("content", "")))[:280],"status":"available","url":page_url(f"/chapter/{cid}/#kp-{idx+1}", "knowledge-stars/index.html")})
        connections=[]
        for idx in range(max(0,len(stars)-1)): connections.append([idx,idx+1,"sequence"])
        if len(stars)>3: connections.extend([[0,2,"concept"],[1,3,"concept"]])
        galaxies.append({"id":f"chapter-{cid}","chapter":cid,"name":course["title"],"name_en":f"SECTOR {cid:02d}","progress":0,"stars":stars,"connections":connections,"palette":palettes[cid-1]})
    return {"success":True,"summary":{"galaxies":len(galaxies),"stars":sum(len(g["stars"]) for g in galaxies),"completed":0},"galaxies":galaxies}


def patch_static_assets():
    star_js = FRONTEND / "static" / "js" / "knowledge_stars.js"
    text = star_js.read_text(encoding="utf-8")
    text = text.replace('fetch("/api/knowledge-universe", { credentials: "same-origin", cache: "no-store" })', 'fetch("/data/knowledge-universe.json", { cache: "no-store" })')
    text = re.sub(r'\s*if \(response\.status === 401 \|\| response\.url\.includes\("/login"\)\) \{ location\.assign\("/login"\); return; \}', '', text)
    star_js.write_text(text, encoding="utf-8")
    html_path = FRONTEND / "static" / "knowledge_stars.html"
    text = html_path.read_text(encoding="utf-8").replace('href="/dashboard"', 'href="/dashboard/"')
    html_path.write_text(text, encoding="utf-8")
    # Static learning coach: keep identical visual language but replace API calls with local browser state.
    coach = (FRONTEND / "static" / "interview.html").read_text(encoding="utf-8")
    coach = coach.replace('/static/js/learning_coach.js', '/static/js/learning_coach_static.js')
    coach = coach.replace('id="loadingOverlay" hidden', 'id="loadingOverlay" style="display:none"')
    (FRONTEND / "static" / "interview.html").write_text(coach, encoding="utf-8")
    (FRONTEND / "static" / "js" / "learning_coach_static.js").write_text(static_coach_js(), encoding="utf-8")


def rewrite_project_urls():
    """Make legacy static pages work from both local root and GitHub project path."""
    route_re = re.compile(r'(["\'`])/(assets|data|static|dashboard|knowledge-stars|chapter|canvas|playground|transition)([^"\'` ]*)')
    for path in FRONTEND.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".html", ".js", ".css"}:
            continue
        source = path.relative_to(FRONTEND).as_posix()
        text = path.read_text(encoding="utf-8")
        text = route_re.sub(lambda match: match.group(1) + page_url("/" + match.group(2) + match.group(3), source), text)
        text = text.replace("llm-training-game.html", "llm_training_game.html")
        text = text.replace("bpe-game.html", "bpe_game.html")
        if source == "static/js/knowledge_stars.js":
            # fetch() resolves relative to the document URL, not the script URL.
            text = text.replace("../../data/knowledge-universe.json", "../data/knowledge-universe.json")
        if path.parts[-2:] in {("rag_cg", "index.html"), ("prompt_cg_starlab", "index.html"), ("agentic_cg", "index.html"), ("claude_cg", "index.html")}:
            text = text.replace('"/vite.svg"', '"vite.svg"').replace("'/vite.svg'", "'vite.svg'")
        path.write_text(text, encoding="utf-8")


def main():
    courses = load("courses_index.json")
    chapters = {i: load(f"chapter_{i:02d}.json") for i in range(1, 11)}
    write("assets/frontend.css", shell_css())
    write("assets/dashboard-demo.css", dashboard_css())
    write("assets/chapter-demo.css", chapter_css())
    write("assets/frontend.js", runtime_js())
    write("index.html", '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=dashboard/"><title>AI Master 前端演示</title></head><body><p>正在进入 <a href="dashboard/">AI Master 前端演示</a>...</p></body></html>''')
    write("dashboard/index.html", build_dashboard(courses))
    for cid, chapter in chapters.items(): write(f"chapter/{cid}/index.html", chapter_page(chapter))
    write("data/knowledge-universe.json", json.dumps(build_universe(courses, chapters), ensure_ascii=False, indent=2))
    atlas = (FRONTEND / "static" / "knowledge_stars.html").read_text(encoding="utf-8")
    atlas = atlas.replace('href="css/knowledge_stars.css"', 'href="../static/css/knowledge_stars.css"')
    atlas = atlas.replace('src="bgm.mp3"', 'src="../static/bgm.mp3"')
    atlas = atlas.replace('src="vendor/three.r128.min.js"', 'src="../static/vendor/three.r128.min.js"')
    atlas = atlas.replace('src="js/knowledge_stars.js"', 'src="../static/js/knowledge_stars.js"')
    write("knowledge-stars/index.html", atlas)
    write("canvas/index.html", '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../assets/frontend.css"><title>AI Master - 思维画布</title></head><body>''' + nav("canvas/index.html") + '''<main class="demo-page"><section class="chapter-hero"><p class="kicker">KNOWLEDGE CANVAS</p><h1>思维画布</h1><p>前端复现版保留知识导航与互动页面。完整的云端保存、AI 辅助生成与个人数据同步需要后端服务。</p><a class="btn btn-primary" href="../dashboard/">返回指挥舱 ↗</a></section></main></body></html>''')
    write("playground/index.html", '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../assets/frontend.css"><link rel="stylesheet" href="../assets/chapter-demo.css"><title>AI Master - 训练舱</title></head><body>''' + nav("playground/index.html") + '''<main class="demo-page"><section class="chapter-hero"><p class="kicker">PRACTICE BAY</p><h1>训练舱</h1><p>选择任一章节进入知识节点和实验页面。本前端版本不保存答题记录，但所有课程导航、交互实验与高级页面均可直接打开。</p><a class="btn btn-primary" href="../dashboard/#route">选择学习章节 ↗</a></section></main></body></html>''')
    write("learning-center/index.html", '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=../static/interview.html"><title>星辰学习中心 · AI Master</title></head><body><p>正在进入 <a href="../static/interview.html">星辰学习教练静态演示</a>...</p></body></html>''')
    write("transition/index.html", '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=../dashboard/"><title>AI Master</title></head><body></body></html>''')
    write("start-demo.bat", '''@echo off\nsetlocal\ncd /d "%~dp0"\necho AI Master frontend demo: http://127.0.0.1:8080/dashboard/\nstart "" http://127.0.0.1:8080/dashboard/\npython -m http.server 8080\n''')
    patch_static_assets()
    rewrite_project_urls()
    print("Generated static frontend routes and data.")


if __name__ == "__main__":
    main()
