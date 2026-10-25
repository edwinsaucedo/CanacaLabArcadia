@echo off
title CanacaLabArcadia - Instalacion
cd /d "%~dp0"
echo.
echo  CANACALAB ARCADIA - Instalacion (solo se hace una vez)
echo  ------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  No encontre Node.js. Se necesita solo para instalar CanacaLabArcadia.
  echo  Intentando instalar Node.js LTS con winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo.
    echo  No se pudo instalar automaticamente. Descargalo de https://nodejs.org ^(version LTS^),
    echo  instalalo y vuelve a abrir este archivo.
    start https://nodejs.org/es/download
    pause
    exit /b 1
  )
  echo.
  echo  Node.js instalado. CIERRA esta ventana y vuelve a abrir 1-INSTALAR.bat
  pause
  exit /b 0
)
echo  Node.js encontrado:
node --version
echo.
echo  Descargando componentes de CanacaLabArcadia (puede tardar unos minutos)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo  Fallo la instalacion. Revisa tu conexion a internet y vuelve a intentarlo.
  pause
  exit /b 1
)
echo.
echo  Listo. Ahora abre 2-ABRIR-CANACALAB ARCADIA.bat
echo  Para tener CanacaLabArcadia.exe ^(recomendado para Sunshine^), abre 3-CREAR-EXE.bat
pause
