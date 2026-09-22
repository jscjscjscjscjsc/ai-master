# AI Master 星辰学习系统 —— 评审可访问的在线部署镜像
#
# 构建上下文是「AI Master 学习平台」目录：
#   docker compose -f deploy/docker-compose.yml up -d --build
#
# 依赖刻意只有 flask 与 edge-tts：平台的 HTTP、JSON、子进程、线程、哈希
# 全部用标准库实现，依赖越少越不容易在服务器上装不上。
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_NO_CACHE_DIR=1 \
    STARLAB_OPEN_BROWSER=0

WORKDIR /srv/aimaster

# 依赖单独一层：改代码时不用重装
COPY requirements.txt ./
RUN pip install -r requirements.txt \
 && pip install gunicorn

COPY . .

# 建服务用户，但容器仍以 root 启动 —— deploy/entrypoint.py 要 root
# 才能把挂载卷的属主交给它，然后再 setuid 降权。真正的 Flask 进程不是 root。
RUN useradd -m -u 10002 starlab \
 && mkdir -p data logs \
 && chown -R starlab:starlab /srv/aimaster

EXPOSE 5178

CMD ["python", "deploy/entrypoint.py"]
