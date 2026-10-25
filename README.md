# CanacaLabArcadia

Frontend multi-consola para **ROG Ally X** (y cualquier PC con Windows x64): todas tus consolas en una sola interfaz, navegable con el control y lista para streaming.

CanacaLabArcadia no emula nada por sí misma: abre el mejor emulador de código abierto para cada consola (RetroArch, PCSX2, RPCS3, Dolphin, PPSSPP, xemu, Xenia Canary, Eden, shadPS4) y los instala y configura sola, controles incluidos.

## Instalar (sin Node.js)

1. Baja `CanacaLabArcadia-<versión>-win-x64.zip` de [Releases](https://github.com/edwinsaucedo/CanacaLabArcadia/releases).
2. Descomprímelo y abre **`INSTALAR.bat`**.
3. Se instala en `C:\CanacaLabArcadia\app`, crea los accesos directos y se abre. La biblioteca (juegos, BIOS, partidas, ajustes) vive en `C:\CanacaLabArcadia`.

En el primer uso: **Agregar carpeta** (enlace de tu carpeta de ROMs en Google Drive) y **Conectar Google**. Lo demás (emuladores, núcleos, BIOS desde tu Drive, firmware de PS3, disco de Xbox, portadas) lo hace el piloto automático.

La guía completa está en [LEEME.md](LEEME.md).

## Desde el código

Requiere Node.js 20 o más nuevo.

```bat
npm install
npm test          :: 80 pruebas
npm start         :: abre la app
npm run dist:dir  :: genera dist\win-unpacked\CanacaLabArcadia.exe
```

También están los atajos `0-INSTALAR-TODO.bat` (compila e instala de una vez), `1-INSTALAR.bat`, `2-ABRIR-ARCADIA.bat` y `3-CREAR-EXE.bat`.

| Carpeta | Qué hay |
|---|---|
| `src/main` | Proceso principal de Electron: biblioteca, emuladores, nube (rclone), piloto automático, portadas, controles |
| `src/renderer` | Interfaz (`app.js`, `styles.css`); `mock.js` permite verla en un navegador sin Electron |
| `config` | Catálogo de consolas y emuladores, mapeo de carpetas de Drive |
| `tests` | Pruebas con `node --test` |
| `instalador` | `INSTALAR.bat` y `LEEME.txt` que van dentro del zip de Releases |

## Privacidad

Tus llaves de IGDB/ScreenScraper, tu cuenta de Google (`rclone.conf`) y el enlace de tu carpeta de Drive se guardan solo en `C:\CanacaLabArcadia\config` de tu equipo; no están en este repositorio ni en el instalador.

## Nota legal

CanacaLabArcadia no incluye juegos, BIOS ni firmware con derechos de autor. Usa solo copias de juegos y BIOS que te pertenecen. El firmware de PS3 y el disco de Xbox se descargan de sus fuentes oficiales y públicas.
