@echo off
cd /d "%~dp0"
docker compose --profile tunnel up -d --build
if errorlevel 1 (
  echo.
  echo Nao foi possivel iniciar a NEBLK. Confira se o Docker Desktop esta aberto e se o arquivo .env foi configurado.
  pause
  exit /b 1
)
echo.
echo NEBLK iniciada.
echo Loja: https://www.neblk.com.br
echo Admin: https://admin.neblk.com.br
pause
