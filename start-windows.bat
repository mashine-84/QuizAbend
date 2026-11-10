@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js fehlt - bitte von https://nodejs.org installieren. & pause & exit /b)
node server.js
pause
