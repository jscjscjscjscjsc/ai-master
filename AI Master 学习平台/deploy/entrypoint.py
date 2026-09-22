"""容器入口：理顺挂载卷属主 → 降权 → 起 gunicorn。

与 PyMaster 那份是同一套做法（两个平台共用一台服务器，运维习惯保持一致）。

为什么需要它
------------
服务以非 root 用户（starlab, uid 10002）跑，而 bind mount / 云盘挂上来的
目录属主通常是 root —— 应用写不进去，表现是「注册报 500」「学习进度存不下来」。
这里在启动前把可写目录的属主改成服务用户，再用 setuid 降权。

端口从 PORT 环境变量读（平台普遍这么注入），写死会在健康检查上失败。
"""
import os
import pwd
import sys

APP_DIR = '/srv/aimaster'
DATA_DIR = (os.environ.get('STARLAB_DATA_DIR') or '').strip() or os.path.join(APP_DIR, 'data')
SERVICE_USER = 'starlab'

WRITABLE = [
    DATA_DIR,
    os.path.join(APP_DIR, 'logs'),
]


def prepare_as_root():
    try:
        account = pwd.getpwnam(SERVICE_USER)
    except KeyError:
        print(f'[entrypoint] 镜像里没有 {SERVICE_USER} 用户，保持当前身份运行', flush=True)
        return

    for path in WRITABLE:
        try:
            os.makedirs(path, exist_ok=True)
        except OSError as exc:
            print(f'[entrypoint] 跳过 {path}：{exc}', flush=True)
            continue
        for current, dirs, files in os.walk(path):
            for name in [current] + [os.path.join(current, n) for n in dirs + files]:
                try:
                    os.chown(name, account.pw_uid, account.pw_gid)
                except OSError:
                    pass

    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)


def main():
    if os.geteuid() == 0:
        prepare_as_root()

    port = (os.environ.get('PORT') or '5178').strip()
    workers = (os.environ.get('STARLAB_WORKERS') or '1').strip()
    # 星辰教练是 SSE 流式，每路对话占一个线程；评审可能几个人同时点
    threads = (os.environ.get('STARLAB_THREADS') or '16').strip()

    print(f'[entrypoint] 以 {pwd.getpwuid(os.geteuid()).pw_name} 身份启动，'
          f'监听 0.0.0.0:{port}（workers={workers} threads={threads}）', flush=True)

    cmd = [
        'gunicorn',
        '--workers', workers,
        '--threads', threads,
        '--timeout', '300',
        '--graceful-timeout', '30',
        '--access-logfile', '-',
        '--error-logfile', '-',
        '-b', f'0.0.0.0:{port}',
        'app:app',
    ]
    os.execvp(cmd[0], cmd)


if __name__ == '__main__':
    main()
