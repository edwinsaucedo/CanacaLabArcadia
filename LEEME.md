# CanacaLabArcadia

Frontend multi-consola para tu **ROG Ally X**: una sola interfaz con todas tus consolas, navegable con el control, que acomoda tus juegos solita y está lista para jugar en el iPad por streaming.

CanacaLabArcadia **no emula nada por sí misma**: abre el mejor emulador de código abierto para cada consola (los mismos que usan EmuDeck o RetroBat), con su configuración y controles listos.

| Consola | Emulador | Instalación |
|---|---|---|
| NES, SNES, N64, Game Boy / Color, GBA, DS, Genesis, PS1 | RetroArch (núcleos Mesen, Snes9x, Mupen64Plus-Next, Gambatte, mGBA, melonDS DS, Genesis Plus GX, PCSX ReARMed) | Automática |
| Arcade (MAME) y Neo Geo | RetroArch (núcleos MAME y FBNeo) | Automática |
| PlayStation 2 | PCSX2 | Automática |
| PlayStation 3 | RPCS3 | Automática |
| PlayStation 4 | shadPS4 (experimental) | Automática |
| PSP | PPSSPP | Automática |
| GameCube y Wii | Dolphin | Automática |
| Xbox | xemu | Automática |
| Xbox 360 | Xenia Canary | Automática |
| Switch | Eden (o Ryujinx/Ryubing) | Automática (Eden, desde su sitio oficial) |

---

## 1. Instalar (una sola vez)

**Lo más fácil:** doble clic en **`0-INSTALAR-TODO.bat`**. Hace todo de corrido (componentes, `CanacaLabArcadia.exe`, copia a `C:\CanacaLabArcadia\app` y accesos directos en el escritorio y el menú Inicio) y abre el programa al terminar. Si algo falla, el detalle queda en `instalacion.log`.

Si prefieres hacerlo por partes:

1. Descomprime la carpeta `arcadia` donde quieras, por ejemplo `C:\CanacaLabArcadia-app`.
2. Doble clic en **`1-INSTALAR.bat`**. Si no tienes Node.js, lo instala con winget (solo se usa para instalar). Descarga Electron y lo demás: tarda unos minutos.
3. Doble clic en **`3-CREAR-EXE.bat`**. Genera `dist\win-unpacked\CanacaLabArcadia.exe`. Copia la carpeta `win-unpacked` a donde quieras y crea un acceso directo a `CanacaLabArcadia.exe`.
   - Si solo quieres probar, `2-ABRIR-CANACALAB ARCADIA.bat` abre CanacaLabArcadia sin crear el .exe.

> En la Ally X puedes agregar `CanacaLabArcadia.exe` a Armoury Crate (Biblioteca > Agregar juego) para abrirlo desde el botón de la consola.

## 2. Primer uso: abrir y jugar

No hay que configurar nada. Al abrir CanacaLabArcadia la primera vez:

1. **La biblioteca queda en `C:\CanacaLabArcadia`** sin preguntar (se puede cambiar en Menú > Biblioteca, por ejemplo a la microSD):

   ```
   C:\CanacaLabArcadia\
     roms\nes  roms\ps2  roms\ps3  ...   <- tus juegos, una carpeta por consola
     bios\                               <- BIOS, firmware y llaves
     emulators\                          <- los emuladores (modo portable)
     saves\                              <- partidas y estados guardados
     media\covers\<consola>\             <- portadas
     config\                             <- ajustes, favoritos y tiempo jugado
   ```

2. **Conecta tu cuenta de Google** con el botón de arriba de la pantalla principal (es lo único que CanacaLabArcadia no puede hacer sola: el inicio de sesión es tuyo). Desde ese momento **todos los juegos de tu Drive aparecen en tu biblioteca** con una nubecita ☁, aunque todavía no estén en la Ally.
3. **Elige un juego y presiona A.** Si está en tu Drive, se descarga (ves el avance, la velocidad y cuánto falta) y **se abre solo al terminar**. Si el emulador de esa consola no está, se instala en ese momento. La próxima vez abre al instante y sin internet.

Mientras tanto, en segundo plano y sin que lo pidas (lo ves en el chip de arriba a la derecha):

- Se instalan los emuladores (y núcleos de RetroArch) de las consolas donde tienes juegos, en la Ally o en tu Drive. Siempre de su sitio o repositorio oficial.
- Se baja tu carpeta **BIOS** de Drive (y lo nuevo que subas después) y cada archivo se acomoda donde lo busca su emulador.
- Xbox: se baja el disco duro en blanco del proyecto xemu. PS3: se baja el firmware oficial de los servidores de Sony y se instala al abrir tu primer juego de PS3 (RPCS3 se abre y se cierra solo).
- Se buscan las portadas de tus juegos.
- Mientras juegas no empieza nada nuevo, para no quitarle rendimiento al juego.

Lo único que sí tienes que poner tú son los archivos de **tus** consolas, en la carpeta **BIOS** de tu Google Drive:

| Consola | Qué necesitas | Dónde se pone |
|---|---|---|
| PS1 | Recomendado: BIOS `scph5501.bin` de tu consola | Carpeta BIOS |
| PS2 | BIOS de **tu** PS2 (`.bin` de 4 MB) | Carpeta BIOS. **CanacaLabArcadia configura PCSX2 sola** (BIOS, sin asistente y con tu control). |
| PS3 | Nada: el firmware oficial se baja de Sony y se instala solo | (Si ya tienes `PS3UPDAT.PUP` en la carpeta BIOS, se usa ese) |
| PS4 | Juegos ya extraídos en carpeta (`CUSAxxxxx` con `eboot.bin`) | `roms\ps4\` |
| Xbox | `mcpx_1.0.bin` y BIOS (por ejemplo `Complex_4627.bin`) | Carpeta BIOS. **CanacaLabArcadia configura xemu sola** (archivos, disco duro y pantalla completa). |
| Neo Geo | `neogeo.zip` (set para FBNeo) | Carpeta BIOS (se copia donde lo busca FBNeo) |
| Switch | `prod.keys` y firmware de **tu** Switch (en .zip o sueltos) | Carpeta BIOS. **CanacaLabArcadia los instala en Eden sola.** |

### Switch (Eden)

1. **Eden se instala solo**, desde su sitio oficial (`stable.eden-emu.dev`). No uses instaladores de otras páginas: circulan copias falsas con su nombre.
2. **Llaves y firmware:** sube a la carpeta **BIOS** de tu Google Drive tu `prod.keys` (suelto o en un .zip con "keys" en el nombre) y el firmware de **tu** Switch (un .zip con "firmware" en el nombre). CanacaLabArcadia los instala en Eden sola (en segundo plano, menos de un minuto, una sola vez). Las llaves deben ser de la misma versión del firmware o más nuevas.
3. **Updates y DLC:** ponlos en tu carpeta de Switch de Drive junto al juego (por ejemplo `Juego [0100ABCD12340800][v1].nsp`). CanacaLabArcadia los reconoce por su title ID o, si no lo traen, por el nombre del juego más la palabra *Update* o *DLC* (por ejemplo `Super Smash Bros Ultimate Update v13.0.2.7z` y `Super Smash Bros Ultimate 99 DLCs.rar` van con `Super Smash Bros. Ultimate (World) (Base Game).7z`; sirven .nsp, .zip, .7z y .rar). No los muestra como juegos aparte, **los baja junto con su juego** (y los nuevos que subas después) y le dice a Eden que los use (contenido externo): no hay que instalarlos en Eden.
4. **Control:** el control con el que abres el juego queda como jugador 1 en Eden. Si lo cambias a mano en Eden, CanacaLabArcadia lo respeta.

Ryujinx (Ryubing) sigue siendo opcional y a mano: <https://ryujinx.app>, en `C:\CanacaLabArcadia\emulators\ryujinx\`.

## 3. Agregar juegos

Tienes tres formas, de la más fácil a la más manual:

1. **Arrastra** archivos o carpetas (incluso una USB entera) a la ventana de CanacaLabArcadia.
2. Botón **Agregar juegos** (o el botón View del control) > "Elegir una carpeta o USB".
3. Copia los archivos tú misma a `roms\<consola>\` y usa Menú > Biblioteca > Actualizar biblioteca.

CanacaLabArcadia **lee la cabecera** de cada disco para saber de qué consola es: un `.iso` puede ser de PS2, PSP, PS3, GameCube, Wii, Xbox o Xbox 360 y lo distingue sola. También mueve juntos los archivos que van en pareja (`.cue` + `.bin`, discos de un `.m3u`, `.iso` + `.dkey` de PS3). Solo te pregunta cuando es imposible saberlo (por ejemplo, un `.chd` suelto).

| Consola | Formatos |
|---|---|
| NES | .nes .unf .fds .zip .7z |
| SNES | .sfc .smc .zip .7z |
| N64 | .z64 .n64 .v64 .zip .7z |
| Game Boy / Color, GBA, DS | .gb .gbc / .gba / .nds (y .zip, .7z) |
| GameCube / Wii | .iso .rvz .gcz .wbfs .wia .ciso .wad |
| Switch | .nsp .xci |
| Genesis | .md .gen .smd .bin .zip |
| PS1 | .cue (+.bin) .chd .pbp .m3u |
| PS2 | .iso .chd .cso .zso |
| PS3 | Carpeta del juego (con `PS3_GAME`) o .iso descifrado / .iso + .dkey |
| PS4 | Carpeta `CUSAxxxxx` con `eboot.bin` |
| PSP | .iso .cso .pbp .chd |
| Xbox | .iso en formato **XISO** (convierte los volcados completos con `extract-xiso`; CanacaLabArcadia te avisa) |
| Xbox 360 | .iso .xex .zar o carpeta con `default.xex` |
| MAME / Neo Geo | romsets .zip (los nombres se muestran legibles: `mslug.zip` aparece como "Metal Slug") |

**Portadas:** se buscan solas en segundo plano, también para los juegos que todavía están en tu Drive (y puedes forzarlo en Menú > Biblioteca > "Buscar portadas ahora"). Para que encuentre casi todas, activa las **portadas inteligentes** en Menú > Biblioteca > Portadas inteligentes > Configurar:

- **IGDB** (gratis, con tu cuenta de Twitch): en <https://dev.twitch.tv/console> registra una app (nombre CanacaLabArcadia, OAuth Redirect URL `http://localhost`, categoría "Application Integration", tipo "Confidential"), y copia el **Client ID** y el **Client Secret** (botón "New Secret"). Twitch pide tener activada la verificación en dos pasos. Busca por el título limpio dentro de la consola y elige el juego más parecido: ideal para PS3, PS4, Switch y Xbox 360.
- **ScreenScraper** (opcional, el más exacto para retro): reconoce el archivo por su huella (MD5), nombre, tamaño y consola, aunque se llame "Copia de...". Necesita tu cuenta de <https://www.screenscraper.fr> y un **ID de desarrollador**, que se pide una vez en su foro (sección de la API).
- Sin llaves sigue funcionando con libretro-thumbnails (solo nombres exactos No-Intro / Redump).

Las llaves quedan en `C:\CanacaLabArcadia\config\portadas.json` (solo en tu Ally; no van en el instalador). Funciona con nombres tipo No-Intro / Redump, por ejemplo `Super Mario World (USA).sfc`. También puedes poner tu propia imagen en `media\covers\<consola>\<nombre del archivo>.png`. Los juegos de PS3 y PS4 usan su propio ícono. Sin portada, CanacaLabArcadia dibuja una con el título.

**Juegos en la microSD sin copiarlos:** Menú > Biblioteca > "Agregar carpeta" en la consola que quieras.

## 4. Descargar de tu Google Drive

**Tu carpeta de ROMs (una vez):** Menú > **Nube** > "Agregar carpeta" y pega el enlace de tu carpeta de Google Drive (drive.google.com/drive/folders/...). Cada subcarpeta (PS2, Nintendo Switch, Arcade, BIOS…) se asigna sola a su consola.

**Tus juegos de Drive en la biblioteca:** con la cuenta conectada, cada juego de tu Drive aparece en su consola (y en la vista por Juegos) con una nubecita ☁ y su tamaño. A lo descarga **primero en la fila** y lo abre al terminar; con B sigues navegando y la descarga continúa (te avisa cuando está lista). La lista de tu Drive se actualiza cada vez que abres CanacaLabArcadia y se guarda para verla sin internet.

**Conectar la cuenta (una vez):** botón **Conectar Google** en la pantalla principal (o Menú > **Nube** > "Conectar cuenta de Google"). Se abre el navegador: entra con la cuenta dueña de la carpeta y acepta el permiso de **solo lectura** (CanacaLabArcadia no puede borrar ni cambiar nada de tu Drive). La primera vez CanacaLabArcadia descarga **rclone** (la herramienta que habla con Drive, unos 20 MB).

**Descargar varios juegos a la vez:** en una consola, botón **"Descargar de la nube"** (o Agregar juegos > "Descargar de Google Drive").

| Botón | En la vista de la nube |
|---|---|
| Arriba / abajo en la lista izquierda | Cambia de carpeta (se abre sola) |
| A sobre una carpeta | Salta a sus juegos |
| A sobre un juego | Lo descarga (dos toques con mouse o pantalla táctil) |
| X | Descarga todos los pendientes de la carpeta |
| Y | Vuelve a leer la carpeta de Drive (si subiste algo nuevo) |
| LB / RB | Cambia de carpeta configurada (si tienes varias) |

Al terminar, el juego aparece en tu biblioteca listo para jugar. Lo que ya bajaste dice **"En tu biblioteca"**.

- Los `.zip` / `.7z` se descomprimen solos cuando la consola no los lee comprimidos (PS2, PSP, GameCube…). En retro, MAME y Neo Geo se quedan como `.zip`, que es lo correcto.
- `.cue` + `.bin` y los discos de un `.m3u` bajan juntos. Una carpeta de juego (PS3, PS4, `CUSAxxxxx`) baja completa.
- **BIOS** va a `C:\CanacaLabArcadia\bios`. `neogeo.zip` además se copia a `bios\fbneo` (ahí lo busca FBNeo) y junto a tus juegos de Neo Geo y de MAME.
- **PC** no es una consola: aparece como "Sin consola". Con A puedes asignarle una si ahí guardas juegos de otra.

**Otras cuentas u otras carpetas (parametrizable):** Menú > Nube.

- "Conectar otra cuenta" agrega más cuentas (Google 1, Google 2…).
- "Agregar carpeta" pide un nombre, el **enlace** de la carpeta de Drive y con qué cuenta abrirla. Sirve una carpeta tuya o una que te compartieron.
- "Explorar" abre esa carpeta y "Editar" cambia su enlace o su cuenta; si mueves tus ROMs a otra cuenta, solo pega el nuevo enlace y elige esa cuenta.
- Todo queda guardado en `C:\CanacaLabArcadia\config\nube.json` (Menú > Nube > "Abrir nube.json"):

```json
{
  "carpetas": [
    { "id": "roms-principal", "nombre": "ROMs (Google Drive)",
      "enlace": "https://drive.google.com/drive/folders/ID_DE_TU_CARPETA", "cuenta": "" },
    { "id": "respaldo", "nombre": "ROMs en mi otra cuenta",
      "enlace": "https://drive.google.com/drive/folders/OTRO_ID", "cuenta": "google2" }
  ],
  "mapeo": { "Arcade": "mame", "Game Boy Color": "gb", "PC": null },
  "descomprimir": true
}
```

`"cuenta": ""` usa la primera cuenta conectada. En `"mapeo"` puedes decir a qué consola va una subcarpeta con nombre raro (`null` = ignorarla). Los nombres normales (PS2, Xbox 360, Super Nintendo…) no necesitan mapeo.

## 5. Controles

| Botón | En CanacaLabArcadia | En un juego |
|---|---|---|
| A | Abrir / jugar | |
| B | Volver | |
| Y | Marcar favorito | |
| X | Saltar a una letra | |
| LB / RB | En la pantalla principal: ver por **Consolas** o por **Juegos**. Dentro de una consola: consola anterior / siguiente | |
| Menú (≡) | Abrir el menú | |
| View (⧉) | Agregar juegos | |
| **View + Menú (mantener 1 s)** | | **Salir del juego y volver a CanacaLabArcadia** (funciona en todos los emuladores) |
| L3 + R3 | | Menú de RetroArch (guardar estado, trucos) en juegos retro |

Con teclado: flechas, Enter, Esc, F (favorito), Q/E (LB/RB), M (menú), I (agregar juegos), F11 (pantalla completa). Con mouse: pasar el puntero encima selecciona, un clic abre y la rueda recorre la fila de consolas. En pantalla táctil: un toque selecciona y el segundo abre.

Si la ventana de CanacaLabArcadia perdió el foco (tocaste la bandeja de Windows u otra app), al presionar cualquier botón del control vuelve al frente sola.

**Dos formas de ver tu biblioteca.** En la pantalla principal, LB / RB (o las pestañas de arriba) cambia entre:
- **Consolas:** el estante con una consola junto a otra.
- **Juegos:** todos tus juegos juntos, de la A a la Z, con filtros arriba (Todos, Favoritos, Jugados hace poco y cada consola). A juega, Y marca favorito y X (o una tecla) salta a una letra.

CanacaLabArcadia recuerda la última vista que usaste. También se elige en Menú > Preferencias > "Pantalla principal por juegos".

**Mapeo: no tienes que configurar nada.** Antes de abrir cada juego, CanacaLabArcadia escribe los controles del emulador (y lo vuelve a revisar cada vez, también en la PC de tus amigos):

| Emulador | Lo que deja listo |
|---|---|
| RetroArch (retro, MAME, Neo Geo) | Driver SDL3 + perfil para controles Xbox / ROG Ally (cruceta, LB/RB, Select, sticks) |
| PCSX2 (PS2) | Puerto 1 con el control integrado, uno externo y el teclado |
| Dolphin (GameCube / Wii) | GameCube y Wiimote + Nunchuk (el stick derecho mueve el puntero) |
| RPCS3 (PS3) | Jugador 1 con el control en vez del teclado |
| PPSSPP, xemu, Xenia, shadPS4 | Reconocen el control solos |
| Eden (Switch) | Se elige una vez en sus Controles (Eden, llaves y firmware se instalan solos) |

Si alguna vez cambias los botones a mano en un emulador, CanacaLabArcadia lo respeta y ya no lo toca. En Menú > Controles hay un probador que ilumina cada botón.

**Otro control (por ejemplo uno de Xbox):** Windows lo pone como control 2, porque el integrado de la Ally X es el 1. CanacaLabArcadia hace que **el control con el que abres el juego sea el jugador 1** en RetroArch y Dolphin; en PCSX2 los dos controles manejan al jugador 1. RetroArch usa el driver de controles **SDL3**, que reconoce el control de la Ally X y los de Xbox (USB o Bluetooth) con el mapeo estándar. En xemu el jugador 1 es el primer control conectado, y en Eden lo eliges en sus Controles.

**Palanca arcade:** ponla en modo Xbox / XInput (casi todas tienen un switch). Si la palanca no tiene ese modo, en RetroArch: L3 + R3 > Controles > Asignación del puerto 1, y guarda como "remapeo del núcleo" para Neo Geo y MAME.

## 6. Sin internet

Menú > Preferencias > **Emuladores sin internet**. Windows te pide permiso de administrador y CanacaLabArcadia crea reglas en el Firewall para que ningún emulador de `C:\CanacaLabArcadia\emulators` se conecte (por ejemplo Eden). Si instalas un emulador nuevo, apágalo y vuelve a activarlo. También puedes usar el script `config\canacalab-arcadia-firewall.ps1` a mano.

## 7. Streaming al iPad

Los juegos corren en la Ally X y el iPad muestra la imagen y manda los botones.

1. En la Ally X instala **Sunshine** (gratis, de LizardByte) y abre su panel web.
2. En Sunshine > Applications > Add New: nombre `CanacaLabArcadia`, comando la ruta a tu exe con `--kiosk`, por ejemplo:
   `"C:\CanacaLabArcadia\app\CanacaLabArcadia.exe" --kiosk`
   (el modo kiosko abre CanacaLabArcadia en pantalla completa sin bordes). Hay un ejemplo listo en `config\sunshine-app.json`.
3. En el iPad instala **Moonlight** (App Store). Con los dos en el mismo Wi-Fi, toca la Ally X y escribe el PIN en el panel de Sunshine.
4. En Moonlight toca **CanacaLabArcadia**. Conecta tu control o palanca al iPad por Bluetooth.

Consejos: Wi-Fi de 5 GHz, la Ally X conectada al cargador y en modo Turbo, y en Sunshine el codificador de AMD (AMF).

## 8. Personalizar

- `config\systems.json`: consolas, colores, extensiones y qué emulador usa cada una (se prueba en orden).
- `config\emulators.json`: emuladores, argumentos de línea de comandos (`{rom}`, `{core}`, `{config}`) y de dónde se descargan.
- `config\arcade-names.json`: nombres legibles para romsets de arcade.
- `config\nube.json` (en tu carpeta de datos): cuentas y carpetas de Google Drive (ver sección 4).

Para agregar una consola nueva copia un bloque de `systems.json`, cambia el `id` y apunta a un emulador existente o nuevo.

## 9. Si algo falla

- **"No se pudo instalar X"**: casi siempre es el internet. Vuelve a presionar A y se reintenta. Si sigue fallando, Menú > Emuladores > "Abrir sitio oficial", descomprime en `C:\CanacaLabArcadia\emulators\<id>\` y CanacaLabArcadia lo encuentra.
- **Un juego de Drive no aparece**: sube el archivo a la subcarpeta de su consola y vuelve a abrir CanacaLabArcadia (o Menú > Nube > Explorar > Y para releer). Los updates y DLC de Switch no salen como juegos: viajan con su juego.
- **Switch: el control no responde en Eden**: abre el juego presionando A con ese control. Si aun así no responde, configúralo una vez en Eden (Menú > Emuladores > Eden > Abrir para configurar > Emulación > Configurar > Controles); desde ahí CanacaLabArcadia ya no lo toca.
- **PS3: "RPCS3 no terminó de instalar el firmware"**: vuelve a abrir el juego; si sigue, borra `C:\CanacaLabArcadia\bios\PS3UPDAT.PUP` para que se baje de nuevo de Sony.
- **Un juego de Xbox dice "inserta el disco"**: es un volcado completo; conviértelo a XISO con `extract-xiso`.
- **Un juego de PS3 en ISO no abre**: debe estar descifrado o ir acompañado de su `.dkey` con el mismo nombre.
- **Un juego de MAME no abre**: el romset no coincide con la versión del núcleo. Prueba FBNeo en `systems.json` (pon `fbneo` primero) o consigue el romset de la versión correcta.
- **La nube dice "No se pudo conectar la cuenta"**: vuelve a intentarlo y acepta el permiso en el navegador. Si el navegador no se abrió, usa el botón "Si el navegador no se abrió, ábrelo aquí".
- **La nube dice que no encuentra la carpeta**: revisa que el enlace sea de una carpeta (`/drive/folders/...`) y que la cuenta elegida tenga acceso a ella.
- **Google dice "cuota de descarga excedida"**: Drive limita las descargas de un mismo archivo por día; espera unas horas.
- **Neo Geo: "one of your romsets is missing files... neogeo"**: falta `neogeo.zip` o es de una versión vieja. CanacaLabArcadia ahora lo revisa antes de abrir el juego y te dice qué le falta. Necesitas un `neogeo.zip` del set de FBNeo: debe traer `sp-s3.sp1`, `sm1.sm1`, `sfix.sfix` y `000-lo.lo` (se comparan por CRC, en `config\systems.json` > neogeo > bios).
- **Conecté un control de Xbox y en el juego no hace nada**: abre el juego presionando A con ese control y será el jugador 1. Si RetroArch muestra "No se ha configurado...", el detalle de qué controles detectó queda en `C:\CanacaLabArcadia\logs\retroarch.log`. Para volver al driver anterior, pon `"retroarchJoypadDriver": "xinput"` en `%APPDATA%\CanacaLabArcadia\settings.json`.
- **PS2 abre pero el control no responde**: si cambiaste los botones de PCSX2 a mano, CanacaLabArcadia no los toca; en PCSX2 > Ajustes > Controladores > Puerto 1 usa "Mapeo automático".
- **El emulador se queda colgado**: mantén View + Menú 1 segundo; si no responde en 3 s, CanacaLabArcadia lo cierra a la fuerza.

## 10. Legal

CanacaLabArcadia y los emuladores son legales. Usa solo juegos, BIOS, firmware y llaves sacados de **tus propias** consolas y discos. CanacaLabArcadia nunca descarga juegos, BIOS ni llaves de internet: solo baja lo que tú misma guardaste en tu propio Google Drive. Lo único que baja por su cuenta es gratuito y oficial: los emuladores (de sus sitios), el firmware de PS3 (de los servidores de Sony) y el disco duro en blanco de Xbox (del proyecto xemu).

## 11. Para desarrollar

```
npm install          # dependencias
npm start            # abrir en modo desarrollo
npm test             # 63 pruebas: deteccion de discos, escaneo, importador, instalador, lanzador, nube, BIOS, PCSX2/xemu, controles
npm run dist:dir     # crear CanacaLabArcadia.exe
```

Puedes abrir `src/renderer/index.html` en un navegador servido localmente (por ejemplo `npx http-server .` y luego `/src/renderer/index.html`) y la interfaz funciona con datos de ejemplo, ideal para cambiar el diseño.

```
src/main/main.js        proceso principal (ventana, IPC, sesiones de juego)
src/main/detect.js      deteccion de consola (ISO9660, XDVDFS, GameCube/Wii, CSO, RVZ, ZIP, PBP)
src/main/scanner.js     biblioteca por consola (titulos, regiones, discos, portadas)
src/main/importer.js    agregar juegos (copiar/mover con archivos acompanantes)
src/main/emulators.js   localizar, instalar (GitHub / sitios oficiales) y elegir emulador
src/main/launcher.js    armar el comando y vigilar el juego
src/main/xinput.js      combinacion View + Menu para salir (XInput directo)
src/main/configs.js     configuracion inicial de RetroArch y perfiles de Dolphin
src/renderer/           interfaz (sin frameworks: HTML, CSS y JS)
```
