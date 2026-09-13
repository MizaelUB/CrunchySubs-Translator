# CrunchySubs-Translator &amp; Tools

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

CrunchySubs-Translator & Tools es una extensión de navegador avanzada diseñada para inyectar, traducir y sincronizar subtítulos en tiempo real sobre el reproductor de video de Crunchyroll. Permite elegir cualquier pista de subtítulos disponible como origen y traducirla a un idioma de destino configurable, además de cargar archivos `.ass` o `.vtt` manualmente.

## 🚀 Instalación (Modo Desarrollador)

1. Clona o descarga este repositorio en tu computadora.
2. Abre tu navegador basado en Chromium (Chrome, Edge, Brave, etc.) y ve a `chrome://extensions/`.
3. Activa el **Modo de desarrollador** (Developer mode) en la esquina superior derecha.
4. Haz clic en **Cargar descomprimida** (Load unpacked).
5. Selecciona la carpeta donde guardaste o clonaste este repositorio.
6. ¡Listo! La extensión ya está instalada y activa.

## 📖 Uso

1. Ve a cualquier episodio de [Crunchyroll](https://www.crunchyroll.com).
2. Haz clic en el ícono de la extensión en tu navegador.
3. Se abrirá el panel de control donde podrás:
   - **Modos de subtítulos**: *Sin traducir* (muestra tal cual la pista oficial de Crunchyroll en el idioma que elijas), *Traducir* (traducción en tiempo real del idioma de origen al de destino) o *Archivo local* (tu propio `.srt` o `.vtt`).
   - **Sincronización**: Corregir subtítulos retrasados o adelantados con los botones del popup, el panel flotante sobre el vídeo o los atajos `,` y `.` (con `Shift`, ±1 s). Funciona en los tres modos y el desfase se recuerda por idioma de origen o por archivo local.
   - **Personalización Visual**: Cambiar el tamaño, fuente, color, borde y opacidad del fondo de los subtítulos.
4. Los subtítulos se mostrarán integrados de manera nativa sobre el reproductor, adaptándose a su resolución.

## 🏗️ Arquitectura General

El proyecto está diseñado siguiendo las directrices de **Manifest V3** de Chrome y está compuesto de los siguientes módulos clave:

### 1. Interceptor de Red (`scripts/inject.js`)
Dado que Crunchyroll empaqueta su información de streaming en un sistema ofuscado y protegido por **CSP (Content Security Policy)**, la extensión no puede espiar el tráfico nativo desde un entorno aislado normal.
- **`world: "MAIN"`**: Este script se inyecta directamente en el contexto de ejecución nativo de la página.
- **Intercepción Dinámica**: Sobrescribe globalmente las clases `window.fetch` y `XMLHttpRequest.prototype.open`/`send`.
- **Detección de Subtítulos**: Cada vez que la web hace una petición HTTP, el interceptor examina si la URL es un archivo de subtítulos legítimo (como `.ass` o manifiestos JSON), captura la URL de la descarga y la envía a nuestro script aislado usando el evento `postMessage` (`CR_STREAMS_DATA`).

### 2. Motor de Visualización y SPA (`scripts/content.js`)
Este archivo funciona de forma aislada (`world: "ISOLATED"`) para no chocar con el código fuente de Crunchyroll, pero con privilegios para manipular el DOM.
- **Soporte Single Page Application (SPA)**: Utiliza un `MutationObserver` adosado a la raíz del documento para detectar la aparición de nuevas etiquetas `<video>` y así reiniciar su motor de inyección entre cambios de episodios sin obligar al usuario a recargar la página.
- **Analizador Dinámico (Parser ASS/VTT)**: Decodifica texto `ASS` y `VTT`. En ASS conserva `PlayResX/PlayResY`, estilos V4+, colores BGR con alpha, alineaciones 1-9 y overrides como `\an`, `\pos`, `\move`, `\c`, `\fs`, `\b` e `\i`.
- **Posicionamiento por cue**: Renderiza cada línea en una capa absoluta sobre el video. Las cues ASS respetan sus coordenadas, ancla, márgenes, color, fuente, tamaño, contorno y fades; SRT/VTT mantienen el comportamiento inferior centrado.
- **Inyección Dinámica de Estilos**: Usa Variables de CSS (`--sub-font`, `--sub-color`, etc.) inyectadas en tiempo real para que cualquier ajuste visual que haga el usuario se aplique de forma fluida y sin recargas.

### 3. Optimizaciones de Sincronización y Latencia
El reto más grande en la inyección de subtítulos traducidos al vuelo es la latencia de red.
- **Precisión a 60 FPS**: Utiliza `requestAnimationFrame` en lugar del tradicional `timeupdate`. El sistema evalúa el tiempo del video cada vez que el monitor pinta un cuadro nuevo (~16ms), dando una sincronización cinematográfica.
- **Zero-Delay Pre-Translator (Lookahead)**: Para evitar retrasos de aparición mientras se espera la API de traducción, el sistema mira **5 segundos en el futuro**. Recolecta las líneas de diálogo que están a punto de aparecer en el video y las pre-traduce silenciosamente en paralelo.
- **Mapeo Multilínea**: Asegura que los subtítulos con múltiples saltos de línea regresen perfectamente formados tras su paso por el traductor, evitando que diálogos densos se desfasen.
- **Ajuste Manual de Desfase**: Cuando una pista oficial o un archivo propio van adelantados o retrasados, un panel flotante sobre el reproductor, los atajos de teclado (`,`, `.` y sus variantes con `Shift`) y un indicador en pantalla permiten corregir el desfase en vivo, incluso a pantalla completa. El desfase se guarda por idioma de origen o por archivo local en el mapa `syncOffsets` de `chrome.storage.local` y se reaplica solo al cambiar de episodio, tanto con traducción como sin ella.

### 4. Servicio de Traducción en Fondo (`scripts/background.js`)
- Utiliza `chrome.runtime.sendMessage` para comunicarse con la UI.
- **Google Translate API**: Hace una solicitud HTTP hacia el endpoint oculto y abierto de Google `translate.googleapis.com` usando el cliente `gtx`, enviando dinámicamente el idioma de origen y el de destino.

### 5. Interfaz de Usuario (`popup/`)
Un panel de control completo, minimalista y fácil de usar.
- **Modos de Subtítulos**: Permite elegir entre mostrar la pista oficial sin traducir ("Sin traducir"), traducirla en tiempo real ("Traducir"), cargar subtítulos locales, o desactivar la extensión por completo.
- **Idiomas configurables**: En modo automático muestra las pistas disponibles del episodio actual para seleccionar el origen y ofrece una lista de idiomas de destino.
- **Personalización Visual Total**: Los usuarios pueden ajustar el tamaño de fuente, color de fuente, opacidad del fondo negro, color y grosor del borde (para legibilidad), fuente tipográfica (incluyendo la clásica Trebuchet MS o Arial) y la posición vertical de los subtítulos. Los carteles (signs) del archivo ASS conservan siempre su posición, color y fuente originales, con un multiplicador dedicado para su tamaño de texto (por defecto 70 % para que se vean más pequeños que en el ASS original).
- Se comunica directamente con `chrome.storage.local` para memorizar la configuración y transmite las variables visuales al `content.js`.

---

## 🔒 Privacidad y Permisos Recomendados
- **Permisos de Almacenamiento**: Requerido exclusivamente para recordar las preferencias de personalización visual e idioma del usuario.
- **Permisos de Host (`*://*.crunchyroll.com/*`)**: Exclusivo sobre la plataforma objetivo para leer su DOM e interceptar las solicitudes de video.
- **Llamadas a Terceros**: Permite peticiones directas a `https://translate.googleapis.com/*` únicamente con motivos de traducción textual sobre la marcha. Ninguna información del usuario o de navegación viaja en estas peticiones.

---

## 🤝 Contribuir
¡Las contribuciones son bienvenidas! Si deseas mejorar el parser de subtítulos, optimizar la latencia o añadir nuevas opciones visuales, por favor revisa el archivo [CONTRIBUTING.md](CONTRIBUTING.md) para más detalles.

## 📄 Licencia
Este proyecto está bajo la Licencia MIT. Consulta el archivo [LICENSE](LICENSE) para más información.
