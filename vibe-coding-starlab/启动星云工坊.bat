@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "PYTHON="
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import flask" >nul 2>&1 && set "PYTHON=.venv\Scripts\python.exe"
)
if not defined PYTHON (
  python -c "import flask" >nul 2>&1 && set "PYTHON=python"
)

if not defined PYTHON (
  echo [ERROR] Flask is not available.
  echo Run: python -m pip install -r requirements.txt
  pause
  exit /b 1
)

echo Starting Vibe Coding Starlab...
start "Vibe Coding Starlab Server" /B "%PYTHON%" app.py
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:5050/"

echo Website opened: http://127.0.0.1:5050/
echo Keep this window open while using the website.
pause
