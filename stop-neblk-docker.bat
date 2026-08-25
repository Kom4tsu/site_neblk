@echo off
cd /d "%~dp0"
docker compose stop
if errorlevel 1 (
  echo.
  echo Nao foi possivel parar a NEBLK. Confira se o Docker Desktop esta aberto.
  pause
  exit /b 1
)
echo.
echo NEBLK parada. Banco, fotos e configuracoes foram preservados.
pause
