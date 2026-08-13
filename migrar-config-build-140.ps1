$Path = Join-Path (Get-Location) "supabase-config.js"
if (-not (Test-Path $Path)) { throw "supabase-config.js não encontrado na pasta atual." }
$Backup = "$Path.backup-build-140"
Copy-Item $Path $Backup -Force
$Text = Get-Content $Path -Raw -Encoding UTF8
$Text = [regex]::Replace($Text, 'window\.[A-Z][A-Z0-9_]*_CONFIG\s*=', 'window.TAMOON_CONFIG =', 1)
$Text = [regex]::Replace($Text, 'appName\s*:\s*["''][^"'']*["'']', 'appName: "Tâmo On"', 1)
$Text = [regex]::Replace($Text, '/\*![\s\S]*?\*/|/\*[\s\S]*?\*/', { param($m) $m.Value }, 1)
Set-Content $Path $Text -Encoding UTF8
Write-Host "Configuração migrada. Backup: $Backup" -ForegroundColor Green
