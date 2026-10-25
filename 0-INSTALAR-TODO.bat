@echo off
setlocal
title CanacaLabArcadia - Instalacion automatica
cd /d "%~dp0"
set "LOG=%~dp0instalacion.log"
set "DEST=C:\CanacaLabArcadia\app"
echo [%date% %time%] Inicio > "%LOG%"
echo.
echo  CANACALAB ARCADIA - Instalacion automatica
echo  ------------------------------------------
echo  No cierres esta ventana. Tarda entre 5 y 10 minutos.
echo.
where node >> "%LOG%" 2>&1
if errorlevel 1 (
  echo NO_NODE >> "%LOG%"
  echo  No encontre Node.js. Instalalo desde https://nodejs.org ^(LTS^) y vuelve a abrir este archivo.
  goto :fail
)
node --version >> "%LOG%" 2>&1
echo  [1/4] Descargando componentes...
echo === PASO 1: npm install === >> "%LOG%"
call npm install --no-audit --no-fund >> "%LOG%" 2>&1
if errorlevel 1 goto :fail
echo  [2/4] Creando CanacaLabArcadia.exe...
echo === PASO 2: build === >> "%LOG%"
call npm run dist:dir >> "%LOG%" 2>&1
if errorlevel 1 goto :fail
if not exist "%~dp0dist\win-unpacked\CanacaLabArcadia.exe" (
  echo NO_EXE >> "%LOG%"
  goto :fail
)
echo  [3/4] Copiando a %DEST%...
rem Si CanacaLabArcadia esta abierto, se cierra para poder reemplazar sus archivos.
taskkill /IM CanacaLabArcadia.exe /F >> "%LOG%" 2>&1
timeout /t 2 >nul
echo === PASO 3: copiar === >> "%LOG%"
robocopy "%~dp0dist\win-unpacked" "%DEST%" /E /NFL /NDL /NJH /NP >> "%LOG%" 2>&1
if errorlevel 8 goto :fail
copy /Y "%~dp0build\icon.ico" "%DEST%\icon.ico" >> "%LOG%" 2>&1
echo  [4/4] Creando accesos directos...
echo === PASO 4: accesos directos === >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))){ $s=$w.CreateShortcut((Join-Path $d 'CanacaLabArcadia.lnk')); $s.TargetPath='%DEST%\CanacaLabArcadia.exe'; $s.WorkingDirectory='%DEST%'; $s.IconLocation='%DEST%\icon.ico'; $s.Save(); Write-Output ('Acceso directo: ' + $d) }" >> "%LOG%" 2>&1
echo OK_TODO_LISTO >> "%LOG%"
echo.
echo  Listo. Abriendo CanacaLabArcadia...
start "" "%DEST%\CanacaLabArcadia.exe"
timeout /t 4 >nul
exit /b 0

:fail
echo FALLO >> "%LOG%"
echo.
echo  Hubo un error. Los detalles quedaron en instalacion.log
pause
exit /b 1
