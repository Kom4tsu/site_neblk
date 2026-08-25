[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $ProjectRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop não foi encontrado. Abra o Docker Desktop e tente novamente.'
}

Write-Host "`n== Status dos containers ==" -ForegroundColor Cyan
& docker compose ps
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível consultar os containers.' }

Write-Host "`n== Teste local da loja ==" -ForegroundColor Cyan
try {
  $Health = Invoke-RestMethod -Uri 'http://localhost:3000/health' -TimeoutSec 10
  if ($Health.ok -eq $true) {
    Write-Host 'OK — aplicação responde em http://localhost:3000' -ForegroundColor Green
  } else {
    throw 'A rota /health retornou uma resposta inesperada.'
  }
}
catch {
  Write-Host 'Falhou — confira os logs abaixo:' -ForegroundColor Red
  & docker compose logs --tail 80 neblk
  throw
}

Write-Host "`n== Status do Cloudflare Tunnel ==" -ForegroundColor Cyan
& docker compose ps cloudflared
Write-Host 'Se o container cloudflared estiver em execução e o túnel aparecer Healthy no painel Cloudflare, www.neblk.com.br está publicado.' -ForegroundColor Yellow
