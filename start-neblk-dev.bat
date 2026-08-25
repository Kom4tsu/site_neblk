@echo off
setlocal
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Falha ao iniciar. Confirme se o Docker Desktop esta aberto.
  pause
  exit /b 1
)
echo.
echo Ambiente local iniciado: http://localhost:3000
pause
