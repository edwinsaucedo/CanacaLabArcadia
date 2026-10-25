@echo off
title CanacaLabArcadia - Crear CanacaLabArcadia.exe
cd /d "%~dp0"
if not exist node_modules (
  echo Primero ejecuta 1-INSTALAR.bat
  pause
  exit /b 1
)
echo Creando CanacaLabArcadia.exe (tarda 1 o 2 minutos)...
call npm run dist:dir
if errorlevel 1 (
  echo No se pudo crear el ejecutable.
  pause
  exit /b 1
)
echo.
echo Listo. Tu programa quedo en:
echo   %~dp0dist\win-unpacked\CanacaLabArcadia.exe
echo.
echo Puedes copiar la carpeta win-unpacked a donde quieras (por ejemplo C:\CanacaLabArcadia\app)
echo y crear un acceso directo a CanacaLabArcadia.exe. Para el iPad usa: CanacaLabArcadia.exe --kiosk
explorer "%~dp0dist\win-unpacked"
pause
