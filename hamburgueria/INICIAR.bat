@echo off
cd /d "%~dp0"
title Sistema da Hamburgueria
node -v >nul 2>&1 || (echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org & pause & exit /b)
start "" http://localhost:3000
node server.js
pause
