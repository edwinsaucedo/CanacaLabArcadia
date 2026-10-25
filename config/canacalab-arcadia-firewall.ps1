# CanacaLabArcadia: bloquea (o desbloquea) el acceso a internet de los emuladores con el Firewall de Windows.
# Uso manual (PowerShell como administrador):
#   .\canacalab-arcadia-firewall.ps1 -Biblioteca "C:\CanacaLabArcadia"          -> bloquea
#   .\canacalab-arcadia-firewall.ps1 -Biblioteca "C:\CanacaLabArcadia" -Quitar  -> quita el bloqueo
param(
  [string]$Biblioteca = "C:\CanacaLabArcadia",
  [switch]$Quitar
)

$ErrorActionPreference = 'Stop'
$grupo = 'CanacaLabArcadia - Emuladores sin internet'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host 'Este script necesita permisos de administrador.' -ForegroundColor Yellow
  exit 1
}

# Siempre se borran las reglas anteriores de CanacaLabArcadia para no duplicarlas.
Get-NetFirewallRule -Group $grupo -ErrorAction SilentlyContinue | Remove-NetFirewallRule

if ($Quitar) {
  Write-Host 'Listo: los emuladores vuelven a tener internet.' -ForegroundColor Green
  exit 0
}

$carpeta = Join-Path $Biblioteca 'emulators'
$patron = '^(retroarch|pcsx2.*|dolphin|ppssppwindows64|ppssppwindows|rpcs3|shadps4|xemu|xenia_canary|xenia|eden|ryujinx)\.exe$'
$exes = Get-ChildItem -Path $carpeta -Recurse -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $patron }

if (-not $exes) {
  Write-Host "No encontre emuladores en $carpeta" -ForegroundColor Yellow
  exit 0
}

foreach ($e in $exes) {
  New-NetFirewallRule -DisplayName "CanacaLabArcadia: sin internet para $($e.BaseName)" -Group $grupo `
    -Direction Outbound -Program $e.FullName -Action Block -Profile Any | Out-Null
  Write-Host "Bloqueado: $($e.FullName)"
}
Write-Host 'Listo: los emuladores ya no pueden conectarse a internet.' -ForegroundColor Green
