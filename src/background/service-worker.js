// service-worker.js — InTruth Chile

let ANTHROPIC_KEY       = '';
let SERPER_KEY          = '';
let DEEPGRAM_KEY        = '';
let TRANSCRIPT_LANGUAGE = 'es';

async function loadKeys() {
  return new Promise(resolve => {
    chrome.storage.local.get(['anthropicKey', 'deepgramKey', 'serperKey', 'transcriptLanguage'], (data) => {
      ANTHROPIC_KEY       = data.anthropicKey       || '';
      DEEPGRAM_KEY        = data.deepgramKey        || '';
      SERPER_KEY          = data.serperKey          || '';
      TRANSCRIPT_LANGUAGE = data.transcriptLanguage || 'es';
      resolve();
    });
  });
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const EVALUATE_PROMPT = `Eres un fact-checker especializado en política, economía e historia chilena. Analiza el fragmento de transcripción e identifica todos los claims factuales que merezcan verificación.

INCLUYE claims que sean:
- Estadísticas específicas (porcentajes, cifras, montos)
- Hechos sobre acciones gubernamentales, leyes aprobadas o rechazadas
- Comparaciones con datos históricos o internacionales verificables
- Datos económicos: PIB, desempleo, inflación, presupuesto, deuda, salario mínimo

EXCLUYE:
- Opiniones y promesas futuras ("vamos a lograr", "deberíamos")
- Preguntas retóricas, saludos, agradecimientos
- Afirmaciones no falsificables ("Chile merece mejor")
- Moderador presentando el debate

Para cada claim devuelve un objeto JSON con estos campos exactos:
- "claim": cita exacta o parafraseo fiel, en español
- "verdict": exactamente uno de: TRUE | SUBSTANTIALLY TRUE | FALSE | MISLEADING | UNVERIFIABLE
- "explanation": análisis en español, máximo 50 palabras
- "confidence": exactamente uno de: HIGH | MEDIUM | LOW
- "speaker": nombre del político si identificable con certeza desde el contexto, si no null
- "speaker_confidence": exactamente uno de: HIGH | MEDIUM | LOW
- "speaker_confidence_explanation": razón breve en español

IMPORTANTE: Usa UNVERIFIABLE SOLO para datos genuinamente no verificables. Un dato aproximadamente correcto es SUBSTANTIALLY TRUE. Devuelve SOLO el array JSON, sin texto adicional.`;


const GROUNDED_PROMPT = `Eres un fact-checker especializado en política, economía e historia chilena. Tienes un claim de un debate político y evidencia de búsqueda web. Evalúa el claim usando la evidencia.

Para el claim devuelve UN objeto en array JSON con estos campos exactos:
- "claim": el claim evaluado, en español
- "verdict": exactamente uno de: TRUE | SUBSTANTIALLY TRUE | FALSE | MISLEADING | UNVERIFIABLE
- "explanation": explicación citando la evidencia, en español, máximo 80 palabras. Incluye la URL si confirma o contradice el dato.
- "confidence": exactamente uno de: HIGH | MEDIUM | LOW
- "speaker": nombre del político o null
- "speaker_confidence": exactamente uno de: HIGH | MEDIUM | LOW
- "speaker_confidence_explanation": razón breve en español

REGLAS:
1. La evidencia web es tu fuente primaria — prioriza sobre tu conocimiento base
2. Snippet confirma cifra exacta → TRUE, confidence HIGH
3. Snippet confirma dirección general pero no dato exacto → SUBSTANTIALLY TRUE
4. Snippet contradice → FALSE o MISLEADING (cita la URL)
5. UNVERIFIABLE solo si la evidencia es genuinamente insuficiente
6. No degrades TRUE/SUBSTANTIALLY TRUE a FALSE/MISLEADING solo por snippets incompletos — el fast pass tiene más contexto

Devuelve SOLO el array JSON con un objeto. Sin texto adicional.`;


// ── Speaker parsing ───────────────────────────────────────────────────────────

const SPEAKER_PARSE_NOISE = new Set(['debate','presidencial','debate','presidencial','2024','2023','2022','2021','2020','2019','chile','completo','oficial','vivo','en','vivo','y','vs']);

function parseSpeakersFromTitle(title) {
  if (!title) return [];
  const clean = title.split('|')[0].trim();

  // 'Nombre vs Nombre'
  const vsSplit = clean.split(/\s+(?:vs?\.?|versus|contra|y)\s+/i);
  if (vsSplit.length >= 2) {
    const lastName = part => {
      const words = part.trim().split(/\s+/);
      for (let i = words.length - 1; i >= 0; i--) {
        if (/^[A-ZÁÉÍÓÚÑ]/.test(words[i]) && !SPEAKER_PARSE_NOISE.has(words[i].toLowerCase())) return words[i];
      }
      return null;
    };
    const a = lastName(vsSplit[0]);
    const b = lastName(vsSplit[1]);
    if (a && b) return [a, b];
  }

  return [];
}


// ── Serper web search ─────────────────────────────────────────────────────────

const BLOCKED_DOMAINS = [
  'reddit.com','facebook.com','twitter.com','x.com',
  'tiktok.com','instagram.com','pinterest.com','quora.com',
  'yelp.com','tripadvisor.com','youtube.com',
];

const LANGUAGE_LOCALE = {
  en: { gl: 'us', hl: 'en' },
  es: { gl: 'cl', hl: 'es' },  // Chile override
  pt: { gl: 'br', hl: 'pt' },
  fr: { gl: 'fr', hl: 'fr' },
  de: { gl: 'de', hl: 'de' },
};

async function searchWeb(query, retries = 2) {
  if (!SERPER_KEY) return { organic: [], answerBox: null, knowledgeGraph: null };
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
      body: JSON.stringify({ q: query + ' Chile', num: 6, ...(LANGUAGE_LOCALE[TRANSCRIPT_LANGUAGE] || LANGUAGE_LOCALE.es) }),
    });
    const data = await res.json();

    const organic = (data.organic ?? [])
      .filter(r => r.link && !BLOCKED_DOMAINS.some(d => r.link.includes(d)))
      .slice(0, 3)
      .map(r => ({ url: r.link, title: r.title || '', snippet: r.snippet || '', date: r.date || '' }));

    const answerBox = data.answerBox
      ? { answer: data.answerBox.answer || data.answerBox.snippet || '', title: data.answerBox.title || '', url: data.answerBox.link || '' }
      : null;

    const knowledgeGraph = data.knowledgeGraph
      ? { description: data.knowledgeGraph.description || '', title: data.knowledgeGraph.title || '' }
      : null;

    return { organic, answerBox, knowledgeGraph };
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 500));
      return searchWeb(query, retries - 1);
    }
    console.error('[serper] error:', err);
    return { organic: [], answerBox: null, knowledgeGraph: null };
  }
}


// ── Claude ────────────────────────────────────────────────────────────────────

async function callClaude(userMessage, systemPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 768,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await res.json();
  if (data.error) {
    const msg = data.error.message || 'Unknown API error';
    console.error('[claude] API error:', msg);
    if (activeTabId) chrome.tabs.sendMessage(activeTabId, { type: 'PIPELINE_ERROR', message: msg }).catch(() => {});
    return '';
  }
  const raw = data.content?.[0]?.text?.trim() || '';
  return raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
}

function parseArray(str) {
  const start = str.indexOf('[');
  const end   = str.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  try { return JSON.parse(str.slice(start, end + 1)); }
  catch { return []; }
}


// ── Lexical features (inline — matches content script) ───────────────────────

const HEDGING_WORDS   = ['pienso','creo','quizás','tal vez','probablemente','podría','parece','supongo','más o menos','a lo mejor','puede que'];
const CERTAINTY_WORDS = ['definitivamente','ciertamente','absolutamente','siempre','nunca','claramente','obviamente','sin duda','comprobado','demostrado','estadísticas','porcentaje'];
const FILLER_WORDS    = ['eh','este','o sea','básicamente','literalmente','entonces','bueno','okay','a ver'];
const EMOTIONAL_WORDS = ['desastre','terrible','horrible','increíble','fantástico','nefasto','vergonzoso','inaceptable','excelente','magnífico','corrupto','catastrófico'];
const EXCLUSIVE_WORDS = ['pero','excepto','sin embargo','aunque','salvo','sin','excepto'];
const FP_SINGULAR     = ['yo','me','mi','mío','mía','mismo','misma'];

function extractLexical(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const total = words.length || 1;
  const rate  = (list) => Math.round(words.filter(w => list.some(h => w.includes(h))).length / total * 100);
  return {
    rates: {
      hedging:       rate(HEDGING_WORDS),
      certainty:     rate(CERTAINTY_WORDS),
      filler:        rate(FILLER_WORDS),
      emotional:     rate(EMOTIONAL_WORDS),
      exclusive:     rate(EXCLUSIVE_WORDS),
      firstPersonSg: rate(FP_SINGULAR),
    },
    wordsPerSecond: null,
    wordCount: total,
  };
}

function buildLexicalSummary(f) {
  const r = f.rates || f;
  const notes = [];
  if (r.hedging > 5)       notes.push(`lenguaje dubitativo (${r.hedging}%)`);
  if (r.certainty > 5)     notes.push(`marcadores de certeza (${r.certainty}%)`);
  if (r.filler > 5)        notes.push(`muletillas (${r.filler}%)`);
  if (r.emotional > 5)     notes.push(`lenguaje emocional (${r.emotional}%)`);
  if (r.exclusive > 5)     notes.push(`palabras calificadoras (${r.exclusive}%)`);
  if (r.firstPersonSg > 5) notes.push(`primera persona singular (${r.firstPersonSg}%)`);
  if (f.wordsPerSecond) {
    const pace = f.wordsPerSecond > 3.5 ? 'rápido' : f.wordsPerSecond < 2 ? 'lento' : 'moderado';
    notes.push(`velocidad de habla ${f.wordsPerSecond} p/s (${pace})`);
  }
  return notes.length ? `Características detectadas: ${notes.join(', ')}.` : 'Entrega neutral.';
}


// ── Claim deduplication ───────────────────────────────────────────────────────

const recentClaims   = new Map();
const CLAIM_DEDUP_MS = 200000;

function normalizeClaimKey(claim) {
  return claim.toLowerCase()
    .replace(/[^a-záéíóúñ0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 4)
    .sort()
    .join(' ');
}

function isDuplicate(claim) {
  const key = normalizeClaimKey(claim);
  const now = Date.now();

  for (const [k, v] of recentClaims) {
    const t = Array.isArray(v) ? v[0] : v;
    if (now - t > CLAIM_DEDUP_MS) recentClaims.delete(k);
  }

  if (recentClaims.has(key)) return true;

  const keyWords = new Set(key.split(' ').filter(Boolean));
  const figures  = (claim.match(/\$[\d,.]+(?:\s*(?:billones|millones|miles|mil))?/gi) || [])
    .map(d => d.replace(/[,\s]/g, '').toLowerCase());

  for (const [k, v] of recentClaims) {
    const kWords = k.split(' ').filter(Boolean);
    if (kWords.filter(w => keyWords.has(w)).length / Math.max(keyWords.size, kWords.length) >= 0.35) return true;
    if (figures.length) {
      const origClaim = Array.isArray(v) ? v[1] : '';
      if (origClaim) {
        const origFigures = (origClaim.match(/\$[\d,.]+(?:\s*(?:billones|millones|miles|mil))?/gi) || [])
          .map(d => d.replace(/[,\s]/g, '').toLowerCase());
        if (figures.some(f => origFigures.includes(f))) return true;
      }
    }
  }

  recentClaims.set(key, [now, claim]);
  return false;
}


// ── Rolling window ────────────────────────────────────────────────────────────

const WINDOW_SIZE = 6;
const WINDOW_KEEP = 20;

let sentenceWindow  = [];
let sentenceCount   = 0;
let windowLexical   = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0, _sentenceCount: 0 };
let windowStartTime = null;
let pageTitle       = '';
let pageDate        = '';
let currentSpeakerId  = null;
let lastSpeakerId     = null;
let speakerIdToName   = {};
let confirmedSpeakers = new Set();

function resetWindow() {
  sentenceWindow   = [];
  sentenceCount    = 0;
  windowLexical    = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0, _sentenceCount: 0 };
  windowStartTime  = null;
  currentSpeakerId = null;
  lastSpeakerId    = null;
  speakerIdToName  = {};
  confirmedSpeakers = new Set();
}

async function onNewSentence(text, speakerId) {
  // flush window early on speaker change
  if (lastSpeakerId !== null &&
      speakerId !== null &&
      speakerId !== undefined &&
      speakerId !== lastSpeakerId &&
      sentenceCount % WINDOW_SIZE !== 0 &&
      sentenceWindow.length >= 2) {
    const flushText = sentenceWindow.map(s => s.text).join(' ');
    const flushCounts = {};
    sentenceWindow.slice(-WINDOW_SIZE).forEach(s => {
      if (s.speakerId !== null && s.speakerId !== undefined)
        flushCounts[s.speakerId] = (flushCounts[s.speakerId] || 0) + 1;
    });
    const flushDominantId = Object.keys(flushCounts).length
      ? Object.entries(flushCounts).sort((a,b) => b[1]-a[1])[0][0]
      : null;
    const flushDominantSpeaker = flushDominantId !== null ? (speakerIdToName[flushDominantId] || null) : null;
    const flushLexSnapshot = JSON.parse(JSON.stringify(windowLexical));
    const fsc = flushLexSnapshot._sentenceCount || 1;
    const flr = flushLexSnapshot.rates;
    flr.hedging       = Math.round(flr.hedging       / fsc);
    flr.certainty     = Math.round(flr.certainty     / fsc);
    flr.filler        = Math.round(flr.filler        / fsc);
    flr.emotional     = Math.round(flr.emotional     / fsc);
    flr.exclusive     = Math.round(flr.exclusive     / fsc);
    flr.firstPersonSg = Math.round(flr.firstPersonSg / fsc);
    const flushLexSummary = buildLexicalSummary(flushLexSnapshot);
    windowLexical   = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0, _sentenceCount: 0 };
    windowStartTime = null;
    await evaluateClaims(flushText, pageTitle, flushLexSummary, flushLexSnapshot, flushDominantSpeaker, flushDominantId);
  }
  lastSpeakerId = speakerId;

  const confirmedName = (speakerId !== null && speakerId !== undefined) ? speakerIdToName[speakerId] : null;
  const label         = confirmedName ? `[${confirmedName}]` : (speakerId !== null && speakerId !== undefined ? `[Hablante ${speakerId}]` : null);
  const labeledText   = label ? `${label} ${text}` : text;

  sentenceWindow.push({ text: labeledText, speakerId, speakerName: confirmedName });
  if (sentenceWindow.length > WINDOW_KEEP) sentenceWindow.shift();
  sentenceCount++;

  if (!windowStartTime) windowStartTime = Date.now();

  const f = extractLexical(text);
  const r = f.rates, wr = windowLexical.rates;
  wr.hedging       += r.hedging;
  wr.certainty     += r.certainty;
  wr.filler        += r.filler;
  wr.emotional     += r.emotional;
  wr.exclusive     += r.exclusive;
  wr.firstPersonSg += r.firstPersonSg;
  windowLexical.wordCount += f.wordCount;
  windowLexical._sentenceCount = (windowLexical._sentenceCount || 0) + 1;

  if (sentenceCount % WINDOW_SIZE === 0) {
    const contextText = sentenceWindow.map(s => s.text).join(' ');

    const currentWindowSentences = sentenceWindow.slice(-WINDOW_SIZE);
    const counts = {};
    currentWindowSentences.forEach(s => {
      if (s.speakerId !== null && s.speakerId !== undefined) {
        counts[s.speakerId] = (counts[s.speakerId] || 0) + 1;
      }
    });
    const dominantSpeakerId = Object.keys(counts).length
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
      : null;
    const dominantSpeaker = dominantSpeakerId !== null
      ? (speakerIdToName[dominantSpeakerId] || null)
      : null;

    const elapsed = windowStartTime ? (Date.now() - windowStartTime) / 1000 : null;
    if (elapsed && elapsed > 0) windowLexical.wordsPerSecond = Math.round(windowLexical.wordCount / elapsed * 10) / 10;
    windowStartTime = null;

    const lexicalSnapshot = JSON.parse(JSON.stringify(windowLexical));
    const sc = lexicalSnapshot._sentenceCount || 1;
    const lr = lexicalSnapshot.rates;
    lr.hedging       = Math.round(lr.hedging       / sc);
    lr.certainty     = Math.round(lr.certainty     / sc);
    lr.filler        = Math.round(lr.filler        / sc);
    lr.emotional     = Math.round(lr.emotional     / sc);
    lr.exclusive     = Math.round(lr.exclusive     / sc);
    lr.firstPersonSg = Math.round(lr.firstPersonSg / sc);
    const lexicalSummary = buildLexicalSummary(lexicalSnapshot);

    windowLexical   = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0, _sentenceCount: 0 };
    windowStartTime = null;

    try {
      await evaluateClaims(contextText, pageTitle, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId);
    } catch (e) {
      console.error('[pipeline] window eval error:', e);
    }
  }
}


// ── Evaluation pipeline ───────────────────────────────────────────────────────

async function evaluateClaims(contextText, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId) {
  try {
    const dateContext = pageDate ? `\nFecha: ${pageDate}` : '';

    const titleNames    = parseSpeakersFromTitle(title || '');
    const nameList      = titleNames.join(' y ');
    const speakerLegend = titleNames.length
      ? `\nParticipantes del debate: ${nameList}.` +
        `\nReglas de atribución de hablantes:` +
        `\n- Las etiquetas [Hablante N] indican turno de habla, NO el orden en la lista de participantes.` +
        `\n- Identifica al hablante por: (1) lenguaje en primera persona — "yo", "mi plan", "hemos logrado"; (2) contenido de políticas que coincide con la posición conocida de cada participante; (3) referencias cruzadas entre participantes.` +
        `\n- Usa tu conocimiento del historial político de cada participante para atribuir correctamente.` +
        `\n- NUNCA escribas "Hablante N" ni [Hablante N] en ningún campo de la respuesta.`
      : `\nIdentifica al hablante por lenguaje en primera persona y contenido político. Nunca escribas "Hablante N".`;

    const languageInstruction = `\nREQUISITO DE IDIOMA: escribe los campos "claim" y "explanation" en español. Los valores de "verdict" permanecen en inglés (TRUE, FALSE, etc).`;

    const titleContext = title
      ? `Video: "${title}"${dateContext}${speakerLegend}\n\nEvalúa los claims tal como se hicieron al momento de esta grabación.${languageInstruction}\n\n`
      : `${languageInstruction}\n\n`;

    const lexicalContext = lexicalSummary ? `\n\nAnálisis léxico: ${lexicalSummary}` : '';

    const checkedList = [...recentClaims.values()]
      .filter(v => Array.isArray(v) && v[1])
      .map(v => v[1])
      .slice(-15)
      .join('\n- ');
    const alreadyChecked = checkedList
      ? `\n\nClaims ya verificados en esta sesión — NO re-evalúes estos ni variantes similares:\n- ${checkedList}\n`
      : '';

    const raw     = await callClaude(
      `${titleContext}Transcripción: "${contextText}"${alreadyChecked}${lexicalContext}`,
      EVALUATE_PROMPT
    );
    const results = parseArray(raw);
    const valid   = results.filter(r => r.claim && r.verdict && r.verdict !== 'UNVERIFIABLE' && !isDuplicate(r.claim));

    if (!valid.length) return;

    // Grounded pass selectivo — solo verificamos con evidencia cuando realmente aporta:
    // - FALSE o MISLEADING: siempre (son los más importantes de verificar)
    // - TRUE / SUBSTANTIALLY TRUE con LOW o MEDIUM confidence: verificar
    // - TRUE / SUBSTANTIALLY TRUE con HIGH confidence: confiar en fast pass directamente
    const needsGrounded = r =>
      r.verdict === 'FALSE' ||
      r.verdict === 'MISLEADING' ||
      r.confidence === 'LOW' ||
      r.confidence === 'MEDIUM';

    const toGround   = valid.filter(needsGrounded);
    const fastOnly   = valid.filter(r => !needsGrounded(r));

    // fire Serper searches solo para claims que van a grounded
    const claimSearchPromises = toGround.map(r => searchWeb(r.claim));

    const resolvedSpeaker = r =>
      dominantSpeaker || (r.speaker && !r.speaker.match(/^Hablante\s*\d+$/i) ? r.speaker : null);

    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        type: 'NEW_VERDICT',
        results: valid.map(r => ({
          ...r,
          sources:          [],
          pending:          needsGrounded(r), // fast-only cards van directo como finales
          lexical:          lexicalSnapshot,
          dominantSpeakerId,
          speaker:          resolvedSpeaker(r),
        })),
      }).catch(() => {});
      console.log('[pipeline] fast verdicts:', valid.length,
        `(${toGround.length} a grounded, ${fastOnly.length} fast-only) | hablante:`, dominantSpeaker);
    }

    if (toGround.length) {
      groundAndUpdate(contextText, toGround, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId, claimSearchPromises);
    }

  } catch (err) {
    console.error('[pipeline] error:', err);
  }
}

async function groundAndUpdate(contextText, fastResults, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId, claimSearchPromises = null) {
  try {
    const dateCtx      = pageDate ? `\nFecha: ${pageDate}` : '';
    const languageInstruction = `\nREQUISITO DE IDIOMA: escribe los campos "claim" y "explanation" en español.`;

    const titleContext = title
      ? `Video: "${title}"${dateCtx}\nEvalúa los claims tal como se hicieron al momento de esta grabación. La evidencia web puede incluir artículos posteriores al debate — ignora información no conocida públicamente en el momento del debate.${languageInstruction}\n\n`
      : `${languageInstruction}\n\n`;

    const lexicalContext = lexicalSummary ? `\n\nAnálisis léxico: ${lexicalSummary}` : '';

    const groundedAll = await Promise.all(fastResults.map(async (fastResult, i) => {
      try {
        const searchData = claimSearchPromises
          ? await claimSearchPromises[i]
          : await searchWeb(fastResult.claim);

        if (!searchData.organic?.length && !searchData.answerBox && !searchData.knowledgeGraph) {
          // no search results — finalize with fast verdict
          const resolvedSpeaker = dominantSpeaker || (fastResult.speaker && !fastResult.speaker.match(/^Hablante\s*\d+$/i) ? fastResult.speaker : null);
          return { ...fastResult, sources: [], pending: false, lexical: lexicalSnapshot, speaker: resolvedSpeaker, dominantSpeakerId, _fastClaim: fastResult.claim };
        }

        const urls = searchData.organic.map(r => r.url);

        const parts = [];
        if (searchData.answerBox?.answer) {
          parts.push(`[Respuesta directa] ${searchData.answerBox.title ? searchData.answerBox.title + ': ' : ''}${searchData.answerBox.answer}${searchData.answerBox.url ? '\n' + searchData.answerBox.url : ''}`);
        }
        if (searchData.knowledgeGraph?.description) {
          parts.push(`[Panel de conocimiento] ${searchData.knowledgeGraph.title ? searchData.knowledgeGraph.title + ': ' : ''}${searchData.knowledgeGraph.description}`);
        }
        searchData.organic.forEach((r, idx) => {
          const datePart = r.date ? ` (${r.date})` : '';
          parts.push(`[${idx+1}] ${r.title}${datePart}\n${r.url}\n${r.snippet}`);
        });
        const evidenceBlock = parts.join('\n\n');

        const raw = await callClaude(
          `${titleContext}Transcripción: "${contextText}"\n\nClaim: "${fastResult.claim}"\nVeredicto rápido: ${fastResult.verdict}\n\nEvidencia web:\n${evidenceBlock}${lexicalContext}`,
          GROUNDED_PROMPT
        );
        const parsed = parseArray(raw);
        const match  = parsed.find(r => r.claim && r.verdict);

        if (!match || match.verdict === 'UNVERIFIABLE') return null;

        const resolvedSpeaker = dominantSpeaker
          || (fastResult.speaker && !fastResult.speaker.match(/^Hablante\s*\d+$/i) ? fastResult.speaker : null)
          || (match.speaker && !match.speaker.match(/^Hablante\s*\d+$/i) ? match.speaker : null);

        // code-level protection: never downgrade TRUE/SUBSTANTIALLY TRUE
        const fastWasTrue = fastResult.verdict === 'TRUE' || fastResult.verdict === 'SUBSTANTIALLY TRUE';
        const groundedDowngrades = match.verdict === 'MISLEADING' || match.verdict === 'FALSE';
        const finalVerdict = (fastWasTrue && groundedDowngrades) ? fastResult.verdict : match.verdict;

        return { ...match, verdict: finalVerdict, sources: urls, pending: false, lexical: lexicalSnapshot, speaker: resolvedSpeaker, dominantSpeakerId, _fastClaim: fastResult.claim };
      } catch (err) {
        console.error('[grounded] error:', fastResult.claim.slice(0, 40), err);
        return null;
      }
    }));

    const valid = groundedAll.filter(Boolean);
    if (valid.length && activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'UPDATE_VERDICTS', results: valid }).catch(() => {});
      console.log('[pipeline] grounded verdicts sent:', valid.length);
    }
  } catch (err) {
    console.error('[grounded] error:', err);
  }
}


// ── State ─────────────────────────────────────────────────────────────────────

let activeTabId       = null;
let isCapturing       = false;
let keepAliveInterval = null;

function startKeepAlive() {
  keepAliveInterval = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
}

function stopKeepAlive() {
  clearInterval(keepAliveInterval);
  keepAliveInterval = null;
}


// ── Messages ──────────────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener(() => console.log('[service-worker] woken by port connect'));

chrome.runtime.onStartup.addListener(() => {
  isCapturing = false;
  activeTabId = null;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'START_FACTCHECK':
      startFactCheck()
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'STOP_FACTCHECK':
      stopFactCheck();
      sendResponse({ ok: true });
      break;

    case 'TRANSCRIPT_RESULT':
      if (msg.isFinal) {
        if (msg.speaker !== null && msg.speaker !== undefined) {
          currentSpeakerId = msg.speaker;
          if (activeTabId && !confirmedSpeakers.has(currentSpeakerId) && !speakerIdToName[currentSpeakerId]) {
            chrome.tabs.sendMessage(activeTabId, {
              type:      'NEW_SPEAKER',
              speakerId: currentSpeakerId,
              sample:    msg.text.slice(0, 80),
            }).catch(() => {});
          }
        }
        onNewSentence(msg.text, currentSpeakerId);
      }
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, {
          type: 'TRANSCRIPT_RESULT', text: msg.text, isFinal: msg.isFinal, interim: msg.interim,
        }).catch(() => {});
      }
      break;

    case 'SPEAKER_NAMES':
      if (msg.speakerIdToName) {
        Object.entries(msg.speakerIdToName).forEach(([id, name]) => {
          const numId = parseInt(id);
          if (!confirmedSpeakers.has(numId)) {
            speakerIdToName[numId] = name;
            confirmedSpeakers.add(numId);
          }
        });
        console.log('[service-worker] mapa de hablantes actualizado:', speakerIdToName);
      }
      break;

    case 'PAGE_TITLE':
      pageTitle = msg.title || '';
      pageDate  = msg.date  || '';
      console.log('[service-worker] título de página:', pageTitle.slice(0, 60));
      break;

    case 'PIPELINE_ERROR':
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, { type: 'PIPELINE_ERROR', message: msg.message }).catch(() => {});
      }
      break;

    case 'REQUEST_NEW_STREAM':
      if (activeTabId && isCapturing) {
        chrome.tabCapture.getMediaStreamId({ targetTabId: activeTabId }, (streamId) => {
          if (chrome.runtime.lastError) {
            console.error('[service-worker] error obteniendo nuevo stream:', chrome.runtime.lastError.message);
            return;
          }
          chrome.runtime.sendMessage({ type: 'START_CAPTURE', streamId, deepgramKey: DEEPGRAM_KEY, language: TRANSCRIPT_LANGUAGE }).catch(() => {});
        });
      }
      break;

    case 'GET_STATUS':
      sendResponse({ isCapturing });
      break;
  }
});


// ── Start / stop ──────────────────────────────────────────────────────────────

async function sendToTabWithInject(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    return; // content script already running — nothing to inject
  } catch (_) {}

  // Content script not on this tab — inject it now
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'src/content/lexical-features.js',
        'src/content/session-export.js',
        'src/content/overlay.js',
      ],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files:  ['src/content/overlay.css'],
    });
  } catch (injectErr) {
    console.warn('[service-worker] inject error (probablemente ya cargado):', injectErr.message);
  }

  await new Promise(r => setTimeout(r, 150));
  await chrome.tabs.sendMessage(tabId, msg); // reintento
}

async function startFactCheck() {
  if (isCapturing) return;

  await loadKeys();

  if (!ANTHROPIC_KEY) {
    throw new Error('Anthropic API key no configurada. Ingrésala en el popup de la extensión.');
  }
  if (!DEEPGRAM_KEY) {
    throw new Error('Deepgram API key no configurada. Ingrésala en el popup de la extensión.');
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No se encontró pestaña activa.');
  activeTabId = tab.id;

  try {
    await ensureOffscreenDocument();
    console.log('[service-worker] documento offscreen creado');
  } catch (err) {
    console.error('[service-worker] error creando offscreen:', err);
  }

  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: activeTabId }, id => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });

  const response = await chrome.runtime.sendMessage({
    type:        'START_CAPTURE',
    streamId,
    deepgramKey: DEEPGRAM_KEY,
    language:    TRANSCRIPT_LANGUAGE,
  });
  if (!response?.ok) throw new Error('Error al iniciar captura: ' + response?.error);

  isCapturing = true;
  resetWindow();
  recentClaims.clear();
  startKeepAlive();

  await sendToTabWithInject(activeTabId, { type: 'START_FACTCHECK' });
  console.log('[service-worker] iniciado en pestaña', activeTabId);
}

function stopFactCheck() {
  resetWindow();
  recentClaims.clear();
  pageTitle = '';
  pageDate  = '';

  if (!isCapturing) return;

  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }).catch(() => {});
  chrome.offscreen.closeDocument().catch(() => {});
  if (activeTabId) chrome.tabs.sendMessage(activeTabId, { type: 'STOP_FACTCHECK' }).catch(() => {});

  activeTabId = null;
  isCapturing = false;
  stopKeepAlive();
  console.log('[service-worker] detenido');
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url:           chrome.runtime.getURL('src/offscreen/offscreen.html'),
    reasons:       ['USER_MEDIA'],
    justification: 'Capturar audio de la pestaña para transcripción con Deepgram',
  });
}
