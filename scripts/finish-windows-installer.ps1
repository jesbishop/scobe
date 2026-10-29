$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$env:ELECTRON_BUILDER_CACHE = Join-Path (Get-Location) '.build-cache/builder'
$env:TEMP = Join-Path (Get-Location) '.build-cache/tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
node scripts/check-cloud-release.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
npx electron-builder --win --publish never --prepackaged "release/$releaseVersion/win-unpacked"
if ($LASTEXITCODE -ne 0) { throw 'Installer creation failed. See the error above.' }
Write-Host "Installer ready: release/$releaseVersion/Scobe-Setup.exe"
