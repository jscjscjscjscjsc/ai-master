# AI Master · 大模型通识课学习平台

> 纯前端静态版本，GitHub Pages 免费部署，无需后端、无需注册。

## 在线体验

https://jscjscjscjscjsc.github.io/ai-master

## 项目简介

AI Master 是一个大模型通识课学习平台，从原理到实践系统化学习 AI 知识。此仓库为 **纯前端静态版本**，所有数据从 JSON 文件加载，无需后端服务器。

## 内容概览

| 章节 | 内容 |
|------|------|
| 01 | 大模型基础原理 - LLM 核心概念、发展历程、工作原理 |
| 02 | Transformer 架构详解 - 自注意力机制、多头注意力、位置编码 |
| 03 | 提示词工程基础 - Prompt 核心原则与范式 |
| 04 | 驾驭框架与智能体概念 - LangChain 到 Agent 架构 |
| 05 | Claude Code 入门细致讲解 |
| 06 | RAG 技术详解 |
| 07 | 阿里云ACP大模型认证（上） |
| 08 | 阿里云ACP大模型认证（下） |
| 09 | 大模型应用实战 |
| 10 | 各类 Agent 教学与测试 |

## 交互式学习工具

- **3D 知识星海** - Three.js 驱动的知识星系可视化
- **BPE 分词游戏** - 交互式学习 Tokenization
- **Transformer 实验室** - 可视化注意力机制
- **沉浸远征** - 3D 航线式的章节导航
- **Prompt 视觉课** - 提示词工程交互式学习

## 本地运行

```bash
# 方式一：直接打开
open index.html

# 方式二：使用 Python 本地服务器
python -m http.server 8080 -d .
```

## 技术栈

- 纯 HTML5 + CSS3 + JavaScript（ES6+）
- Three.js（3D 可视化）
- 手写 CSS（无框架依赖）
- 数据源：静态 JSON 文件

## 关于

原始项目为 Python Flask 全栈应用，这是为 GitHub Pages 制作的纯前端静态版本。