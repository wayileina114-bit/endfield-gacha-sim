# Build script: create extract-and-run release zip (ASCII only to avoid PS encoding issues)
# Usage: powershell -ExecutionPolicy Bypass -File tools\make-package.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stage = Join-Path $env:TEMP "endfield-gacha-pkg"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

$include = @('server.js','start.bat','stop.bat','stop-server.ps1','package.json','README.md','src','data','public','runtime')
foreach ($name in $include) {
  $src = Join-Path $root $name
  if (Test-Path $src) { Copy-Item $src (Join-Path $stage $name) -Recurse }
}
$saveFile = Join-Path $stage 'data\save.json'
if (Test-Path $saveFile) { Remove-Item $saveFile }

# Compress to ASCII name (PS5.1 chokes on non-ASCII paths in this no-BOM script).
# Rename to the Chinese filename afterwards from the shell.
$asciiOut = Join-Path $root '..\endfield-gacha-sim.zip'
if (Test-Path $asciiOut) { Remove-Item $asciiOut }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $asciiOut -CompressionLevel Optimal
$size = [math]::Round((Get-Item $asciiOut).Length / 1MB, 1)
Write-Host "OK: $asciiOut ($size MB)"
