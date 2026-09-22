@echo off
chcp 936 >nul
cd /d "%~dp0"

REM ============================================================
REM  AI Master 星辰学习系统 —— 一键启动
REM
REM  学生机器上的失败点只有两个：「没装 Python」和「pip 装不上」。
REM  所以这里只认两条路径，逻辑刻意写得很直白：
REM    ① 随包 Python（runtime\python\python.exe）—— 不需要用户装任何东西
REM    ② 系统 Python 建虚拟环境（runtime\venv）—— 精简包走这条路
REM  Python 路径一律用 %~dp0 拼，不做 for /f 捕获：
REM  中文用户名下命令输出会过代码页转换，捕回来的路径是乱码。
REM ============================================================

if not exist "app.py" (
  echo   [错误] 这个启动脚本必须和 app.py 放在同一个文件夹里。
  echo          请把它放回 AI Master 学习平台 目录下再双击。
  echo.
  pause
  exit /b 1
)

REM Python 默认按 UTF-8 输出，而这个窗口是 936 代码页；两边不一致就是乱码。
REM 显式让 Python 用 GBK 说话，控制台的中文提示才能正常显示。
set "PYTHONIOENCODING=gbk"
set "PYTHONUTF8=0"

title AI Master 星辰学习系统

echo.
echo   ============================================================
echo      AI Master 星辰学习系统
echo      学习路线 / 智能体 / 星辰教练 / 星空修为
echo   ============================================================
echo.
echo   第一次启动会自动准备运行环境（约 1 分钟，之后秒开）。
echo   启动完成后浏览器会自动打开 http://127.0.0.1:5178
echo   关闭本窗口即停止服务。
echo.

set "PY="

REM ① 随包 Python
if exist "runtime\python\python.exe" set "PY=%~dp0runtime\python\python.exe"
if defined PY goto ready

REM ② 上次建好的虚拟环境
if exist "runtime\venv\Scripts\python.exe" set "PY=%~dp0runtime\venv\Scripts\python.exe"
if defined PY goto ready

REM ③ 包里有 Python 压缩包但还没解开：自己解，不依赖系统 Python
if exist "runtime\python-embed.zip" (
  echo   [1/3] 正在解压随包 Python（只需一次）...
  if not exist "runtime\python" mkdir "runtime\python"
  tar -xf "runtime\python-embed.zip" -C "runtime\python" 2>nul
  if not exist "runtime\python\python.exe" powershell -NoProfile -Command "Expand-Archive -LiteralPath 'runtime\python-embed.zip' -DestinationPath 'runtime\python' -Force" >nul 2>nul
)
if exist "runtime\python\python.exe" set "PY=%~dp0runtime\python\python.exe"
if defined PY goto ready

REM ④ 精简包（不含 Python）：只能用系统 Python 建虚拟环境
echo   [1/3] 没有随包 Python，改用系统 Python 准备环境...
py -3 "tools\bootstrap_runtime.py"
if not errorlevel 1 goto system_ready
python "tools\bootstrap_runtime.py"
if not errorlevel 1 goto system_ready
goto need_python

:system_ready
if exist "runtime\venv\Scripts\python.exe" set "PY=%~dp0runtime\venv\Scripts\python.exe"
if not defined PY goto need_python
goto launch

:need_python
echo.
echo   [错误] 这台电脑上没有可用的 Python，这个压缩包里也没有附带。
echo.
echo   两个办法，任选其一：
echo     1. 下载"完整版"压缩包（自带 Python，不需要你装任何东西）
echo     2. 自己装 Python 3.12：https://www.python.org/downloads/
echo        安装时务必勾选 "Add python.exe to PATH"，装完重新双击本文件
goto end

:ready
echo   [1/3] 检查运行环境...
"%PY%" "tools\bootstrap_runtime.py"
if errorlevel 1 goto failed

:launch
echo   [2/3] 环境就绪，正在启动服务 http://127.0.0.1:5178
echo.
echo   浏览器没自动打开的话，手动访问 http://127.0.0.1:5178 即可。
echo   首次使用：直接以游客身份体验，或注册账号保存学习进度。
echo.

set STARLAB_OPEN_BROWSER=1
"%PY%" app.py
set "EXITCODE=%errorlevel%"

echo.
if not "%EXITCODE%"=="0" (
  echo   [错误] 服务异常退出（代码 %EXITCODE%）。常见原因：
  echo     · 5178 端口被别的程序占用：关掉其它 AI Master 窗口后重试
  echo     · 杀毒软件拦截了 Python：把本文件夹加入白名单
  echo     · 上面的报错信息可以直接截图反馈
) else (
  echo   服务已停止。
)
goto end

:failed
echo.
echo   [错误] 运行环境没有准备好，请把上面的提示截图反馈。

:end
echo.
pause
