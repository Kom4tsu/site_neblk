@echo off
setlocal
cd /d "%~dp0"
if not exist .env (
  copy .env.production.example .env >nul
  echo Arquivo .env de producao criado.
  echo Edite ADMIN_PASSWORD, PIX e CLOUDFLARE_TUNNEL_TOKEN antes de iniciar.
  notepad .env
)
docker compose --profile tunnel up -d --build
if errorlevel 1 (
  echo.
  echo Falha ao iniciar. Confirme que o Docker Desktop esta aberto e que o .env esta configurado.
  pause
  exit /b 1
)
echo.
echo NEBLK iniciada.
echo Loja:  https://www.neblk.com.br
echo Admin: https://admin.neblk.com.br
pause
