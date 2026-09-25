$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$info = Get-Content (Join-Path $appRoot 'out/distribution/files/build-info.json') -Raw | ConvertFrom-Json
$suffix = if ($info.dirty) { '-dirty' } else { '' }
$name = "vibe-remote-buddy-app-$($info.version)-$($info.short_hash)-$($info.channel)$suffix-windows-x64-setup.exe"
$installer = Join-Path $appRoot "out/distribution/$name"
if (-not (Test-Path -LiteralPath $installer)) { throw "Installer missing: $installer" }
$registeredApp = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Vibe Remote Buddy' -ErrorAction SilentlyContinue
if ($registeredApp) { throw 'Smoke test requires a user account without an existing Vibe Remote Buddy installation' }

# An existing directory with unrelated data catches unsafe recursive uninstall.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $appRoot "build/diagnostics/$stamp-installer-safety/shared"
New-Item -ItemType Directory -Path $target -Force | Out-Null
Set-Content -LiteralPath (Join-Path $target 'leave-me.txt') -Value 'unrelated user file'
New-Item -ItemType Directory -Path (Join-Path $target 'other-data') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $target 'other-data/notes.txt') -Value 'keep this directory'

$install = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$target") -Wait -PassThru -WindowStyle Hidden
if ($install.ExitCode -ne 0) { throw "Installer failed: $($install.ExitCode)" }
$uninstaller = Join-Path $target 'uninstall.exe'
if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Uninstaller was not installed' }

$model = Join-Path $target 'resources/remotes/xiaomi.rc003'
if (-not (Test-Path -LiteralPath (Join-Path $model 'model.json'))) { throw 'Remote model was not installed' }
Set-Content -LiteralPath (Join-Path $model 'user-edited') -Value 'local edit marker'
Set-Content -LiteralPath (Join-Path $model 'model.json') -Value 'user-edited model'

$uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
if ($uninstall.ExitCode -ne 0) { throw "Uninstaller failed: $($uninstall.ExitCode)" }
foreach ($kept in @('leave-me.txt', 'other-data/notes.txt', 'resources/remotes/xiaomi.rc003/user-edited', 'resources/remotes/xiaomi.rc003/model.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $target $kept))) { throw "Uninstaller deleted unrelated or edited data: $kept" }
}
foreach ($removed in @('Vibe Remote Buddy.exe', 'build-info.json', 'uninstall.exe', 'resources/catalog/catalog.json')) {
  if (Test-Path -LiteralPath (Join-Path $target $removed)) { throw "Uninstaller left packaged file: $removed" }
}
Write-Host "PASS: installer and silent uninstaller preserve unrelated files and edited model ($target)"
