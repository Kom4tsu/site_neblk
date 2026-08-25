[CmdletBinding()]
param(
  [string]$DestinationRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'backups')
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$Stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$Destination = Join-Path $DestinationRoot "NEBLK_$Stamp"
$WasStopped = $false

function Invoke-Compose([string[]]$Arguments) {
  & docker compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Falha ao executar: docker compose $($Arguments -join ' ')" }
}

try {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker Desktop não foi encontrado. Abra o Docker Desktop e tente novamente.'
  }

  Set-Location $ProjectRoot
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null

  Write-Host 'Pausando a aplicação por alguns segundos para copiar o SQLite de forma consistente...' -ForegroundColor Yellow
  Invoke-Compose @('stop', 'neblk')
  $WasStopped = $true

  Copy-Item (Join-Path $ProjectRoot 'data') (Join-Path $Destination 'data') -Recurse -Force
  Copy-Item (Join-Path $ProjectRoot 'public\uploads') (Join-Path $Destination 'uploads') -Recurse -Force
  Copy-Item (Join-Path $ProjectRoot '.env') (Join-Path $Destination '.env') -Force

  $Readme = @"
Backup NEBLK criado em $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss').

Conteúdo:
- data\       Banco SQLite e arquivos WAL/SHM, quando existentes.
- uploads\    Fotos cadastradas no painel.
- .env         Configuração de produção e token do túnel.

Para restaurar: pare a NEBLK, substitua as pastas data e public\uploads e o arquivo .env por estes itens, depois inicie novamente com docker compose --profile tunnel up -d --build.
"@
  Set-Content -Path (Join-Path $Destination 'LEIA-ME.txt') -Value $Readme -Encoding utf8

  Write-Host "Backup concluído em: $Destination" -ForegroundColor Green
}
finally {
  if ($WasStopped) {
    Write-Host 'Iniciando a aplicação novamente...' -ForegroundColor Yellow
    try {
      Invoke-Compose @('start', 'neblk')
      Write-Host 'NEBLK iniciada novamente.' -ForegroundColor Green
    }
    catch {
      Write-Warning "Não foi possível reiniciar automaticamente. Rode: docker compose --profile tunnel up -d"
      throw
    }
  }
}
