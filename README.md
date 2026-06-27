# InTruth Chile — Fact-Checking en Tiempo Real

> Extensión de Chrome que transcribe debates políticos chilenos con IA y verifica los claims en tiempo real, mientras escuchas.

---

## ¿Qué hace?

Mientras escuchas un debate, discurso o entrevista política en cualquier pestaña de Chrome:

1. **Transcribe el audio** en tiempo real con reconocimiento de múltiples hablantes (Deepgram)
2. **Detecta claims factuales** cada 6 oraciones (estadísticas, cifras económicas, afirmaciones históricas)
3. **Verifica con Claude 3 Haiku** en un primer pase rápido
4. **Busca evidencia web** (Google Chile vía Serper) para los claims dudosos o falsos
5. **Veredicto final con fuentes** directamente sobre la página que estás viendo

Todo queda en un panel flotante y draggable, sin salir del video.

---

## Veredictos

| Veredicto | Significado |
|---|---|
| VERDADERO | Confirmado por fuentes |
| SUST. VERDADERO | Dirección correcta, cifra aproximada |
| FALSO | Contradicho por evidencia |
| ENGAÑOSO | Técnicamente verdadero pero saca de contexto |
| INVERIFICABLE | Datos que no están en fuentes públicas |

---

## Pantallazos

*(próximamente — en cuanto tenga capturas del panel en acción)*

---

## Requisitos

Esta extensión usa un modelo **BYOK (trae tu propia API key)**. Tú pagas directamente a cada servicio; el desarrollador no ve tu uso ni tu dinero.

Necesitas crear cuenta en **2 servicios obligatorios** (y 1 opcional):

### 1. Anthropic — Requerido

- Sitio: https://console.anthropic.com
- Para qué: detectar y evaluar claims con Claude 3 Haiku
- Costo estimado: **~$0.20–0.30 USD/hora** de debate activo
- Plan gratuito: no, requiere ingresar tarjeta de crédito (cobra por uso)
- Cómo obtener la key: Console → API Keys → Create Key

### 2. Deepgram — Requerido

- Sitio: https://console.deepgram.com
- Para qué: transcripción en tiempo real con identificación de hablantes
- Costo: **$200 USD de crédito gratis** al registrarse (equivale a cientos de horas)
- Cómo obtener la key: Dashboard → API Keys → Create a New API Key

### 3. Serper — Opcional (mejora la precisión)

- Sitio: https://serper.dev
- Para qué: buscar evidencia en Google Chile para claims dudosos
- Costo: **2.500 búsquedas gratis** al mes. Sin esta key, los veredictos son solo con el conocimiento base de Claude.
- Cómo obtener la key: Dashboard → API Key

---

## Instalación

La extensión **no está en la Chrome Web Store** todavía. Se instala manualmente en modo desarrollador:

1. **Descarga el repositorio**
   ```
   Haz click en "Code" → "Download ZIP" en esta página
   ```
   o con git:
   ```
   git clone https://github.com/TU_USUARIO/intruth-chile.git
   ```

2. **Abre Chrome y ve a las extensiones**
   ```
   chrome://extensions/
   ```

3. **Activa el Modo Desarrollador**
   - Toggle "Modo de desarrollador" en la esquina superior derecha

4. **Carga la extensión**
   - Click en "Cargar descomprimida"
   - Selecciona la carpeta `InTruth-Chile` (la que contiene `manifest.json`)

5. **Fija el ícono** en la barra de herramientas (ícono de puzzle → fija InTruth Chile)

---

## Configuración

1. Click en el ícono de InTruth Chile en la barra de Chrome
2. Ingresa tus API keys en los campos correspondientes
3. Las keys se guardan localmente en tu navegador (nunca salen de tu equipo)

---

## Uso

1. Abre un video en YouTube, TVN, Mega, CNN Chile, o cualquier sitio con audio
2. Click en el ícono de InTruth Chile → **"Iniciar Fact-Checking"**
3. Un panel aparece sobre la página con la transcripción en vivo
4. Cuando se detecta un nuevo hablante, aparece un banner para que lo identifiques por nombre
5. Los veredictos aparecen a medida que se procesan
6. Click en **"↓ Exportar"** al final para descargar el reporte en HTML

---

## Estimación de costos

| Duración del debate | Costo Anthropic (estimado) |
|---|---|
| 30 minutos | ~$0.10 USD |
| 1 hora | ~$0.20–0.30 USD |
| Debate presidencial (2h) | ~$0.45–0.60 USD |

Deepgram y Serper prácticamente no cuestan dentro del tier gratuito para uso normal.

---

## Limitaciones conocidas

- Requiere que el audio sea reproducido en Chrome (no funciona con audio del sistema externo a Chrome)
- La precisión de la transcripción depende de la calidad del audio del video
- Los claims muy locales o muy recientes pueden no tener evidencia web disponible
- Funciona mejor con debates formales que con conversaciones informales

---

## Roadmap / Mejoras planeadas

Las siguientes mejoras están en discusión — feedback bienvenido:

- [ ] Modo sin Deepgram: transcripción usando la Web Speech API del navegador (elimina 1 key obligatoria)
- [ ] Historial de sesiones: guardar y comparar debates anteriores
- [ ] Base de datos de promesas: detectar automáticamente promesas de campaña y trackearlas
- [ ] Exportar como PDF además de HTML
- [ ] Soporte para audio fuera de Chrome (micrófono / línea de entrada)

---

## Privacidad

- Las API keys se almacenan solo en tu navegador (`chrome.storage.local`)
- El audio se envía a Deepgram para transcripción (sus términos de privacidad aplican)
- El texto se envía a Anthropic y Serper para análisis (sus términos aplican)
- No existe ningún servidor intermedio del desarrollador — todo va directo desde tu navegador a las APIs

---

## ¿Preguntas o sugerencias?

Abre un [Issue](../../issues) en este repositorio o comenta en el post de Reddit Chile donde se presentó este proyecto.

---

## Licencia

MIT — usa, modifica y distribuye libremente.
