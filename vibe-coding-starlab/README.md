# Vibe Coding · 星云工坊

一个独立的 Flask 小网站：用户输入模糊想法后，由真实模型完成两段式推演，再联网搜索 GitHub 开源项目。设计为可从 AI Master 的章节入口直接跳转。

1. **产品经理智能体**识别目标用户、触发场景、验证信号、非目标与关键取舍。
2. **技术产品负责人智能体**结合第一步诊断和 GitHub 候选项目，生成 5～7 个可交付、可验证、带风险提示的实施阶段。

它不会再用本地固定模板伪装成 AI 回复；未配置模型密钥时，页面会明确提示配置，而不会给出泛化方案。

## 本地启动

最简单的方式是双击 `启动星云工坊.bat`。脚本会启动服务并自动打开浏览器；使用期间请保持脚本窗口打开。

```powershell
cd 'C:\Users\Administrator\Documents\New project\vibe-coding-starlab'
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python app.py
```

浏览器打开 `http://127.0.0.1:5050`，点击“发射灵感”时会弹出“连接你的模型”窗口。填入模型名和 API Key 后立即开始推演；Key 默认只存在当前浏览器标签页，不会写入项目文件或服务器磁盘。

## 接入真实 AI 与联网搜索

弹窗适合本地个人使用。若要部署成多人可访问的网站，建议把 `.env.example` 复制为 `.env` 后填入服务器侧 `DEEPSEEK_API_KEY` 和可选的 `GITHUB_TOKEN`，再将 API 调用改为你的账号配额体系。应用启动时会自动读取项目目录内的 `.env`；生产部署时，请在宿主平台的“环境变量”中配置这两个变量。也可以临时在 PowerShell 中设置：

```powershell
$env:DEEPSEEK_API_KEY='你的密钥'
$env:GITHUB_TOKEN='你的只读 GitHub token'
python app.py
```

GitHub 匿名搜索的速率有限；部署给多人时建议配置只读 Fine-grained token。所有密钥均不得提交到 Git 仓库。

## 部署与 AI Master 集成

可部署到 Railway、Render 或任意支持 Python Web 服务的平台：安装命令 `pip install -r requirements.txt`，启动命令 `gunicorn app:app`，并配置 `DEEPSEEK_API_KEY`、`GITHUB_TOKEN`、`PORT`。

部署后获取类似 `https://vibe.example.com` 的 URL，在 AI Master 对应课程的资源链接/按钮中配置此地址，并使用新窗口打开。此站点不共享 AI Master 的登录状态，因此不处理学习进度或付费权限；需要受控访问时，应由 AI Master 后端签发短期访问令牌后再接入。

## 安全说明

- GitHub 搜索结果只是候选项目；使用前检查许可证、维护状态与依赖安全。
- 模型输出可能不准确，产品功能与市场判断需人工验证。
- 不要把真实 API 密钥写入 `app.py`、HTML、前端 JavaScript 或 Git 仓库。弹窗输入的 Key 仅用于当前浏览器会话；在不可信或公共设备上不要输入个人 Key。
