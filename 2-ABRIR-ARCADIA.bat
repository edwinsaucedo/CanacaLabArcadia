@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Primero ejecuta 1-INSTALAR.bat
  pause
  exit /b 1
)
call npm start
