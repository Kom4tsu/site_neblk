# Corrige o espaço invisível entre DROPS e a lista suspensa.
# Execute dentro da pasta do projeto:
# powershell -ExecutionPolicy Bypass -File .\corrigir-menu-drops.ps1

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$cssPath = Join-Path $projectRoot 'public\css\app.css'
$headPath = Join-Path $projectRoot 'views\partials\head.ejs'
$marker = '/* HOTFIX — menu DROPS: área contínua entre o gatilho e a lista para permitir o clique */'

if (-not (Test-Path $cssPath)) { throw "Arquivo não encontrado: $cssPath" }
if (-not (Test-Path $headPath)) { throw "Arquivo não encontrado: $headPath" }

$css = Get-Content -Raw -Path $cssPath
if ($css -notmatch [regex]::Escape($marker)) {
  Add-Content -Path $cssPath -Value @"

$marker
@media (min-width: 831px) {
  .main-nav .nav-dropdown-menu {
    top: calc(100% - 1px);
  }
}
"@
}

$head = Get-Content -Raw -Path $headPath
$head = $head -replace 'href="/css/app\.css(?:\?[^\"]*)?"', 'href="/css/app.css?v=dropdown-click-fix-1"'
Set-Content -Path $headPath -Value $head -Encoding UTF8

Push-Location $projectRoot
try {
  docker compose up -d --build
  docker compose ps
  Write-Host "`nCorreção aplicada. Atualize o navegador com Ctrl + F5." -ForegroundColor Green
} finally {
  Pop-Location
}
