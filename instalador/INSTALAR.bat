@echo off
setlocal
title CanacaLabArcadia - Instalar desde GitHub
cd /d "%~dp0"
echo.
echo  CANACALAB ARCADIA - Instalar desde GitHub
echo  -----------------------------------------
echo  Une las partes del instalador, lo descomprime e instala. No necesita Node.js.
echo.
set "WORK=%TEMP%\CanacaLabArcadia-instalador"
echo  [1/2] Uniendo y descomprimiendo (1 o 2 minutos)...
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $all = @(Get-ChildItem -LiteralPath '%~dp0.' -Filter 'CanacaLabArcadia-*-win-x64.zip.0*'); if(-not $all.Count){ throw 'No encuentro las partes CanacaLabArcadia-...zip.001, .002, .003 junto a este archivo.' }; $newest = $all | Group-Object { $_.Name -replace '\.\d+$','' } | Sort-Object { [version](($_.Name -replace '^CanacaLabArcadia-','') -replace '-win-x64\.zip$','') } -Descending | Select-Object -First 1; $parts = @($newest.Group | Sort-Object Name); Write-Output ('  Version: ' + $newest.Name); $work = $env:WORK; if(Test-Path $work){ Remove-Item $work -Recurse -Force }; New-Item -ItemType Directory $work | Out-Null; $zip = Join-Path $work 'instalador.zip'; $out = [IO.File]::Create($zip); foreach($p in $parts){ $in = [IO.File]::OpenRead($p.FullName); $in.CopyTo($out); $in.Close() }; $out.Close(); $ok = $false; try { tar -xf $zip -C $work; $ok = ($LASTEXITCODE -eq 0) } catch { }; if(-not $ok){ Expand-Archive -LiteralPath $zip -DestinationPath $work -Force }; Remove-Item $zip"
if errorlevel 1 goto :fail
if not exist "%WORK%\CanacaLabArcadia\INSTALAR.bat" goto :fail
echo  [2/2] Instalando...
call "%WORK%\CanacaLabArcadia\INSTALAR.bat"
exit /b %errorlevel%

:fail
echo.
echo  No se pudo preparar el instalador. Revisa que esten las 3 partes completas
echo  (CanacaLabArcadia-...-win-x64.zip.001, .002 y .003) en esta misma carpeta.
pause
exit /b 1
