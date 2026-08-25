[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $ProjectRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop não foi encontrado. Abra o Docker Desktop e tente novamente.'
}

Write-Host 'Atualizando a imagem do Cloudflare Tunnel...' -ForegroundColor Cyan
& docker compose --profile tunnel pull cloudflared
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível atualizar a imagem do túnel.' }

Write-Host 'Reconstruindo e iniciando a NEBLK...' -ForegroundColor Cyan
& docker compose --profile tunnel up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível atualizar a NEBLK.' }

& "$PSScriptRoot\check-neblk.ps1"
