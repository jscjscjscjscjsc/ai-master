@echo off
setlocal
cd /d "%~dp0"
echo AI Master frontend demo: http://127.0.0.1:8080/dashboard/
start "" http://127.0.0.1:8080/dashboard/
python -m http.server 8080
