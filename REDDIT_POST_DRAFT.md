# BORRADOR — Post para r/chile

---

**TÍTULO:**
Hice una extensión de Chrome que verifica en tiempo real si los políticos mienten en debates — open source, busco feedback

---

**CUERPO DEL POST:**

---

Hola r/chile. Hace tiempo que me cansé de escuchar debates y no tener cómo saber en el momento si las cifras que dan son reales o inventadas. Así que construí esto.

**¿Qué hace InTruth Chile?**

Es una extensión de Chrome. La abres mientras estás viendo un debate, una entrevista política, o un discurso en YouTube / TVN / CNN Chile / lo que sea. Mientras escuchas:

1. Transcribe el audio en vivo e identifica quién está hablando
2. Detecta los claims factuales (estadísticas, cifras, afirmaciones históricas)
3. Los verifica contra Google Chile + Claude IA
4. Te muestra los veredictos directamente sobre la página, en un panel flotante

Todo en tiempo real. Sin salir del video.

**Ejemplo de veredicto:**

> *"El desempleo bajó a 7,8% gracias a nuestras políticas"*
> → **SUST. VERDADERO** — El INE reportó 8,0% en el último trimestre. La dirección es correcta pero la cifra exacta difiere. [fuente: ine.cl]

> *"Chile tiene la inflación más alta de Latinoamérica"*
> → **FALSO** — Según el BID, Argentina, Venezuela y Bolivia registraron inflaciones significativamente superiores. [fuente: iadb.org]

---

**Lo más importante que tienen que saber: requiere 3 API keys**

Acá viene el caveat grande. La extensión no tiene backend propio — funciona con tus propias cuentas de IA. Tienes que crear cuenta en:

1. **Anthropic** (requerida) — la IA que evalúa los claims. No tiene plan gratis, necesitas poner tarjeta. Costo real: ~$0.20 USD por hora de debate activo. No es mucho, pero requiere pasos.

2. **Deepgram** (requerida) — el servicio que transcribe el audio e identifica hablantes. Tienen **$200 USD gratis** al registrarse, así que en la práctica es gratis para uso normal.

3. **Serper** (opcional) — búsqueda en Google Chile. Sin esta key los veredictos son solo con el conocimiento base de la IA, sin verificación web. Tienen **2.500 búsquedas gratis** al mes.

Sé que pedir 3 cuentas de servicios externos es fricción. Por eso necesito feedback sobre si eso es un dealbreaker para ustedes o no.

---

**GitHub (instalación manual por ahora):**

[enlace al repo — pegar aquí al publicar]

Instrucciones completas de instalación en el README. No está en la Chrome Web Store todavía, se instala en "modo desarrollador" de Chrome (tarda 2 minutos, el README explica paso a paso).

---

**¿Por qué open source y BYOK?**

Porque si yo controlara las keys, tendría acceso a las transcripciones de lo que escuchan. Con BYOK, el audio va directo desde tu navegador a Deepgram — yo no veo nada.

---

**¿Qué feedback busco específicamente?**

- ¿El requisito de 3 API keys es un dealbreaker para ti? ¿Llegarías a crear las 3 cuentas?
- ¿Preferirías que hubiera una versión con menos precisión pero sin keys? (hay opciones gratuitas pero peores)
- ¿Qué debates o programas te parecería más útil para esto? (¿Tolerancia Cero? ¿El Informante? ¿Debates presidenciales?)
- ¿Hay algún tipo de claim que priorizarías verificar? (economía, salud, criminalidad, etc.)
- ¿Usarías esto en tu trabajo / estudio / vida cotidiana?

Cualquier comentario sirve. Si alguien quiere probarlo y reportar bugs, también bienvenido.

---

*Proyecto personal, código abierto, sin fines de lucro.*

---

## NOTAS PARA CUANDO PUBLIQUES

- **Subreddits a considerar:** r/chile (principal), también puedes crosspostear en r/ChileActual si quieres más alcance político
- **Mejor horario para publicar en r/chile:** lunes a jueves, entre 19:00 y 22:00 hrs Chile
- **Agrega capturas de pantalla** del panel en acción — los posts con imagen tienen mucho más engagement
- **Si hay un debate próximo** (elecciones, cadena nacional, etc.), publicar antes del evento le da contexto perfecto
- Cuando tengas el repo en GitHub, reemplaza "[enlace al repo — pegar aquí al publicar]" con la URL real
