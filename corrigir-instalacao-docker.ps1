# Correção para versões antigas da entrega que tinham URLs internas no package-lock.json.
# Execute no PowerShell, na pasta raiz do projeto.
$ErrorActionPreference = 'Stop'
$lock = Join-Path $PSScriptRoot 'package-lock.json'
if (-not (Test-Path $lock)) { throw "Arquivo não encontrado: $lock" }

$old = 'https://packages.applied-caas-gateway1.internal.api.openai.org/artifactory/api/npm/npm-public/'
$new = 'https://registry.npmjs.org/'
$content = Get-Content -LiteralPath $lock -Raw
$count = ([regex]::Matches($content, [regex]::Escape($old))).Count

if ($count -gt 0) {
  $content = $content.Replace($old, $new)
  [System.IO.File]::WriteAllText($lock, $content, [System.Text.UTF8Encoding]::new($false))
  Write-Host "package-lock.json corrigido: $count URL(s) atualizada(s)." -ForegroundColor Green
} else {
  Write-Host 'Nenhuma URL interna encontrada; o lock já está corrigido.' -ForegroundColor Yellow
}

if (-not (Test-Path (Join-Path $PSScriptRoot '.npmrc'))) {
@"
registry=https://registry.npmjs.org/
audit=false
fund=false
progress=false
"@ | Set-Content -LiteralPath (Join-Path $PSScriptRoot '.npmrc') -Encoding utf8
  Write-Host '.npmrc criado usando o registro público npmjs.org.' -ForegroundColor Green
}

Write-Host "Agora execute: docker compose build --no-cache; docker compose up -d" -ForegroundColor Cyan
