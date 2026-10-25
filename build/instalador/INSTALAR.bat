@echo off
setlocal
title CanacaLabArcadia - Instalar
cd /d "%~dp0"
set "LOG=%~dp0instalacion.log"
set "DEST=C:\CanacaLabArcadia\app"
echo [%date% %time%] Inicio > "%LOG%"
echo.
echo  CANACALAB ARCADIA 1.10.1 - Instalar
echo  -----------------------------------
echo  No necesita internet ni Node.js. Tarda menos de un minuto.
echo.
if not exist "%~dp0app\CanacaLabArcadia.exe" (
  echo NO_APP >> "%LOG%"
  echo  No encuentro la carpeta "app". Descomprime TODO el .zip y vuelve a abrir INSTALAR.bat
  goto :fail
)
echo  [1/3] Cerrando CanacaLabArcadia si estaba abierta...
taskkill /IM CanacaLabArcadia.exe /F >> "%LOG%" 2>&1
timeout /t 2 >nul
echo  [2/3] Copiando a %DEST%...
echo === copiar === >> "%LOG%"
robocopy "%~dp0app" "%DEST%" /E /NFL /NDL /NJH /NP >> "%LOG%" 2>&1
if errorlevel 8 goto :fail
copy /Y "%~dp0icon.ico" "%DEST%\icon.ico" >> "%LOG%" 2>&1
echo  [3/3] Creando accesos directos (Escritorio y menu Inicio)...
echo === accesos directos === >> "%LOG%"
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))){ $s=$w.CreateShortcut((Join-Path $d 'CanacaLabArcadia.lnk')); $s.TargetPath='%DEST%\CanacaLabArcadia.exe'; $s.WorkingDirectory='%DEST%'; $s.IconLocation='%DEST%\icon.ico'; $s.Save(); Write-Output ('Acceso directo: ' + $d) }" >> "%LOG%" 2>&1
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
