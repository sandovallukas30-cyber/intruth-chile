// overlay.js — InTruth Chile
// Panel draggable en la página con transcripción, claims y veredictos.

console.log('[overlay] InTruth Chile cargado');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let panel            = null;
let transcriptFeedEl = null;
let interimEl        = null;
let claimFeedEl      = null;
let verdictListEl    = null;
let transcriptCollapsed = false;
const pendingCards     = new Map();
const pendingCardTimes = new Map();

// expirar cards pending después de 90 segundos
setInterval(() => {
  const now = Date.now();
  for (const [key, time] of pendingCardTimes) {
    if (now - time > 90000) {
      const card = pendingCards.get(key);
      if (card) {
        card.classList.remove('rtfc-verdict--pending');
        const verifying = card.querySelector('.rtfc-verifying');
        if (verifying) verifying.textContent = '⚠ no verificado';
      }
      pendingCards.delete(key);
      pendingCardTimes.delete(key);
    }
  }
}, 15000);

let lastTranscriptTimestamp = '';
const sentenceTimestamps    = [];
const MAX_TIMESTAMP_BUFFER  = 10;

// ── Estado de hablantes ──────────────────────────────────────────────────────
let speakers = [];

const SPEAKER_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#f97316'];
const speakerColorMap = new Map();

function getSpeakerColor(name) {
  if (!speakerColorMap.has(name)) {
    const idx = speakerColorMap.size % SPEAKER_COLORS.length;
    speakerColorMap.set(name, SPEAKER_COLORS[idx]);
  }
  return speakerColorMap.get(name);
}

// ── Parsing de hablantes desde el título ─────────────────────────────────────
const SPEAKER_PARSE_NOISE = new Set(['debate','presidencial','2024','2023','2022','2021','2020','2019','chile','completo','oficial','en','vivo']);

function parseSpeakersFromTitle(title) {
  if (!title) return [];
  const clean = title.split('|')[0].trim();

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

let lastActiveSpeaker = null;

function normalizeSpeakerName(name) {
  if (!name) return name;
  for (const speaker of speakers) {
    const lastName = speaker.trim().split(' ').pop().toLowerCase();
    if (name.toLowerCase() === speaker.toLowerCase()) return speaker;
    if (name.toLowerCase().includes(lastName)) return speaker;
  }
  return name;
}

function getClaimSpeaker(claimText) {
  if (!speakers.length) return 'Otro';
  const lower = claimText.toLowerCase();
  for (const speaker of speakers) {
    if (lower.includes(speaker.toLowerCase())) return speaker;
  }
  for (const speaker of speakers) {
    const parts = speaker.toLowerCase().split(' ');
    if (parts.some(p => p.length > 3 && lower.includes(p))) return speaker;
  }
  if (lastActiveSpeaker) return lastActiveSpeaker;
  return 'Otro';
}

// ── Confirmación de ID de hablante ───────────────────────────────────────────

const confirmedSpeakerMap = {};
const pendingSpeakerIds   = new Set();

function showSpeakerBanner(speakerId, sample) {
  const sid = String(speakerId);
  if (pendingSpeakerIds.has(sid)) return;
  if (sid in confirmedSpeakerMap) return;
  if (!speakers.length) {
    setTimeout(() => showSpeakerBanner(speakerId, sample), 1000);
    return;
  }
  pendingSpeakerIds.add(sid);

  const banner = document.createElement('div');
  banner.className = 'rtfc-speaker-banner';
  banner.innerHTML =
    '<div class="rtfc-speaker-banner-text">Nuevo hablante detectado — ¿quién es?</div>' +
    '<div class="rtfc-speaker-banner-sample">"' + escapeHtml(sample) + '..."</div>' +
    '<div class="rtfc-speaker-banner-buttons">' +
      speakers.map(name =>
        '<button class="rtfc-speaker-banner-btn" data-name="' + escapeHtml(name) + '" data-id="' + sid + '">' + escapeHtml(name) + '</button>'
      ).join('') +
      '<button class="rtfc-speaker-banner-btn rtfc-speaker-banner-btn--skip" data-id="' + sid + '">Omitir</button>' +
    '</div>';

  banner.querySelectorAll('.rtfc-speaker-banner-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      const id   = btn.dataset.id;
      if (name) {
        confirmedSpeakerMap[id] = name;
        chrome.runtime.sendMessage({
          type: 'SPEAKER_NAMES',
          speakerIdToName: { [id]: name },
        });
      }
      pendingSpeakerIds.delete(id);
      if (!name) confirmedSpeakerMap[id] = null;
      banner.remove();
      retryTagAllCards();
    });
  });

  const verdictsSection = panel?.querySelector('#rtfc-verdicts-section');
  if (verdictsSection) verdictsSection.insertAdjacentElement('beforebegin', banner);
}

function allSpeakersConfirmed() {
  if (!speakers.length) return false;
  return speakers.every((_, i) => String(i) in confirmedSpeakerMap);
}

function retryTagAllCards() {
  if (!verdictListEl) return;
  verdictListEl.querySelectorAll('.rtfc-verdict:not(.rtfc-verdict--pending)').forEach(card => {
    const sid = card.dataset.speakerid;
    if (sid === undefined) return;
    const rawName = confirmedSpeakerMap[sid];
    if (!rawName) return;
    const name = normalizeSpeakerName(rawName);
    let tag = card.querySelector('.rtfc-speaker-tag');
    if (tag) {
      tag.textContent = name;
      tag.style.background = getSpeakerColor(name);
    } else {
      const color = getSpeakerColor(name);
      tag = document.createElement('div');
      tag.className = 'rtfc-speaker-tag';
      tag.style.background = color;
      tag.textContent = name;
      card.insertBefore(tag, card.firstChild);
    }
  });
}

// ── Editor de hablantes ──────────────────────────────────────────────────────

function sendSpeakerMap() {
  const speakerIdToName = {};
  speakers.forEach((name, i) => { speakerIdToName[i] = name; });
  chrome.runtime.sendMessage({ type: 'SPEAKER_NAMES', speakerIdToName });
}

function renderSpeakerEditor() {
  const el = panel?.querySelector('#rtfc-speaker-editor');
  if (!el || !speakers.length) return;

  el.innerHTML = speakers.map((name, i) => {
    const color = getSpeakerColor(name);
    return '<span class="rtfc-speaker-chip" style="border-color:' + color + ';color:' + color + '" data-idx="' + i + '">' +
      '<input class="rtfc-speaker-chip-input" value="' + escapeHtml(name) + '" data-idx="' + i + '" style="color:' + color + '" />' +
    '</span>';
  }).join('');

  el.querySelectorAll('.rtfc-speaker-chip-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx     = parseInt(e.target.dataset.idx);
      const oldName = speakers[idx];
      const newName = e.target.value.trim() || oldName;
      if (newName === oldName) return;

      if (speakerColorMap.has(oldName)) {
        speakerColorMap.set(newName, speakerColorMap.get(oldName));
        speakerColorMap.delete(oldName);
      }

      speakers[idx] = newName;
      e.target.style.color = getSpeakerColor(newName);
      e.target.closest('.rtfc-speaker-chip').style.borderColor = getSpeakerColor(newName);
      e.target.closest('.rtfc-speaker-chip').style.color = getSpeakerColor(newName);
      sendSpeakerMap();

      const cards = verdictListEl?.querySelectorAll('.rtfc-speaker-tag');
      if (cards) {
        cards.forEach(tag => {
          if (tag.textContent === oldName) {
            tag.textContent = newName;
            tag.style.background = getSpeakerColor(newName);
          }
        });
      }
    });
    input.addEventListener('focus', e => e.target.select());
  });
}

// ── Toast de error ───────────────────────────────────────────────────────────

function showError(message) {
  if (!panel) return;
  const existing = panel.querySelector('.rtfc-error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'rtfc-error-toast';
  toast.innerHTML =
    '<span class="rtfc-error-icon">⚠</span>' +
    '<span class="rtfc-error-msg">' + escapeHtml(message) + '</span>' +
    '<button class="rtfc-error-close">✕</button>';

  toast.querySelector('.rtfc-error-close').addEventListener('click', () => toast.remove());
  panel.querySelector('#rtfc-header').insertAdjacentElement('afterend', toast);

  if (!message.includes('fallida') && !message.includes('key') && !message.includes('clave')) {
    setTimeout(() => toast.remove(), 8000);
  }
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function createPanel() {
  if (panel) return;

  panel = document.createElement('div');
  panel.id = 'rtfc-panel';
  panel.innerHTML = [
    '<div id="rtfc-header">',
      '<span><span class="rtfc-dot"></span>InTruth Chile</span>',
      '<div class="rtfc-header-actions">',
        '<button id="rtfc-export" title="Exportar sesión como HTML">↓ Exportar</button>',
        '<button id="rtfc-close">✕</button>',
      '</div>',
    '</div>',
    '<div id="rtfc-body">',
      '<div id="rtfc-transcript-section">',
        '<div class="rtfc-section-header">',
          '<span class="rtfc-section-label">Transcripción</span>',
          '<button class="rtfc-toggle-btn" id="rtfc-transcript-toggle">▾</button>',
        '</div>',
        '<div id="rtfc-transcript-feed"></div>',
        '<p id="rtfc-interim"></p>',
      '</div>',
      '<div id="rtfc-claims-section">',
        '<div class="rtfc-section-header">',
          '<span class="rtfc-section-label">Claims</span>',
        '</div>',
        '<ul id="rtfc-claim-feed"></ul>',
      '</div>',
      '<div id="rtfc-verdicts-section">',
        '<div class="rtfc-section-header">',
          '<span class="rtfc-section-label">Veredictos</span>',
          '<div id="rtfc-speaker-editor"></div>',
        '</div>',
        '<div id="rtfc-verdicts">',
          '<p class="rtfc-empty">Los veredictos aparecerán aquí...</p>',
        '</div>',
      '</div>',
    '</div>',
  ].join('');

  document.body.appendChild(panel);

  transcriptFeedEl = panel.querySelector('#rtfc-transcript-feed');
  interimEl        = panel.querySelector('#rtfc-interim');
  claimFeedEl      = panel.querySelector('#rtfc-claim-feed');
  verdictListEl    = panel.querySelector('#rtfc-verdicts');

  panel.querySelector('#rtfc-close').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_FACTCHECK' });
    removePanel();
  });

  panel.querySelector('#rtfc-export').addEventListener('click', () => exportPDF());

  makeDraggable(panel);

  panel.querySelector('#rtfc-transcript-toggle').addEventListener('click', () => {
    transcriptCollapsed = !transcriptCollapsed;
    transcriptFeedEl.style.display = transcriptCollapsed ? 'none' : '';
    interimEl.style.display = transcriptCollapsed ? 'none' : '';
    panel.querySelector('#rtfc-transcript-toggle').textContent = transcriptCollapsed ? '▸' : '▾';
  });
}

function removePanel() {
  panel?.remove();
  panel            = null;
  transcriptFeedEl = null;
  interimEl        = null;
  claimFeedEl      = null;
  verdictListEl    = null;
  transcriptCollapsed = false;
  pendingCards.clear();
  pendingCardTimes.clear();
  speakers = [];
  speakerColorMap.clear();
  sentenceTimestamps.length = 0;
  lastTranscriptTimestamp   = '';
  lastActiveSpeaker         = null;
  Object.keys(confirmedSpeakerMap).forEach(k => delete confirmedSpeakerMap[k]);
  pendingSpeakerIds.clear();
}

// ── Transcripción ─────────────────────────────────────────────────────────────

function addTranscriptText(text) {
  if (!transcriptFeedEl) return;
  const span = document.createElement('span');
  span.textContent = text + ' ';
  span.className   = 'rtfc-transcript-word';
  transcriptFeedEl.appendChild(span);
  transcriptFeedEl.scrollTop = transcriptFeedEl.scrollHeight;
}

function updateInterim(text) {
  if (!interimEl) return;
  interimEl.textContent = text;
}

function clearInterim() {
  if (!interimEl) return;
  interimEl.textContent = '';
}

// ── Claims ────────────────────────────────────────────────────────────────────

function addClaimBullet(claim) {
  if (!claimFeedEl) return;
  const li = document.createElement('li');
  li.className    = 'rtfc-claim-bullet rtfc-claim-bullet--pending';
  li.dataset.claim = claim.toLowerCase().slice(0, 40);
  li.textContent   = claim;
  claimFeedEl.appendChild(li);
  return li;
}

function applyVerdictToBullet(claim, verdict, confidence) {
  if (!claimFeedEl) return;
  const color     = colorForVerdict(verdict, confidence);
  const claimWords = new Set(claim.toLowerCase().split(/\s+/).filter(w => w.length >= 4));
  const bullets   = claimFeedEl.querySelectorAll('.rtfc-claim-bullet');
  let bestLi = null, bestScore = 0;
  for (const li of bullets) {
    const bulletWords = (li.textContent || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    const overlap = bulletWords.filter(w => claimWords.has(w)).length;
    const score   = overlap / Math.max(claimWords.size, bulletWords.length);
    if (score > bestScore) { bestScore = score; bestLi = li; }
  }
  if (bestLi && bestScore >= 0.3) {
    bestLi.className = 'rtfc-claim-bullet rtfc-claim-bullet--' + color;
  }
}

// ── Veredictos ────────────────────────────────────────────────────────────────

function colorForVerdict(verdict, confidence) {
  if (confidence === 'LOW')              return 'yellow';
  if (verdict === 'TRUE')                return 'green';
  if (verdict === 'SUBSTANTIALLY TRUE')  return 'teal';
  if (verdict === 'FALSE')               return 'red';
  if (verdict === 'MISLEADING')          return 'yellow';
  if (verdict === 'UNVERIFIABLE')        return 'grey';
  return 'grey';
}

function verdictLabel(v) {
  if (v === 'TRUE')               return 'VERDADERO';
  if (v === 'SUBSTANTIALLY TRUE') return 'SUST. VERDADERO';
  if (v === 'FALSE')              return 'FALSO';
  if (v === 'MISLEADING')         return 'ENGAÑOSO';
  if (v === 'UNVERIFIABLE')       return 'INVERIFICABLE';
  return v;
}

function buildLexicalRows(lexical) {
  if (!lexical) return '';
  const rows = [];
  const r = lexical.rates || {};
  if (r.hedging > 0)
    rows.push('<div class="rtfc-conviction-row"><span class="rtfc-conviction-label">Lenguaje dubitativo:</span> ' + r.hedging + '% — ej. "creo", "quizás", "tal vez"</div>');
  if (r.certainty > 0)
    rows.push('<div class="rtfc-conviction-row"><span class="rtfc-conviction-label">Marcadores de certeza:</span> ' + r.certainty + '% — ej. "definitivamente", "siempre"</div>');
  if (r.filler > 0)
    rows.push('<div class="rtfc-conviction-row"><span class="rtfc-conviction-label">Muletillas:</span> ' + r.filler + '% — ej. "eh", "o sea"</div>');
  if (r.emotional > 0)
    rows.push('<div class="rtfc-conviction-row"><span class="rtfc-conviction-label">Lenguaje emocional:</span> ' + r.emotional + '%</div>');
  if (r.exclusive > 0)
    rows.push('<div class="rtfc-conviction-row"><span class="rtfc-conviction-label">Palabras calificadoras:</span> ' + r.exclusive + '% — ej. "pero", "sin embargo"</div>');
  if (r.firstPersonSg > 0)
    rows.push('<div class="rtfc-conviction-row"><span class="rtfc-conviction-label">Primera persona singular:</span> ' + r.firstPersonSg + '%</div>');
  if (lexical.wordsPerSecond != null) {
    const rateDesc = lexical.wordsPerSecond > 3.5 ? 'rápido' : lexical.wordsPerSecond < 2 ? 'lento' : 'moderado';
    rows.push('<div class="rtfc-conviction-row"><span class="rtfc-conviction-label">Velocidad de habla:</span> ' + lexical.wordsPerSecond + ' p/s (' + rateDesc + ')</div>');
  }
  return rows.join('');
}

function buildCard(result) {
  const color = colorForVerdict(result.verdict, result.confidence);
  const convictionColor = result.speaker_confidence === 'HIGH' ? 'green'
                        : result.speaker_confidence === 'LOW'  ? 'red'
                        : 'yellow';

  const card = document.createElement('div');
  card.className = 'rtfc-verdict rtfc-verdict--' + color + (result.pending ? ' rtfc-verdict--pending' : '');
  card.dataset.claim = result.claim.toLowerCase().slice(0, 40);
  if (result.dominantSpeakerId !== null && result.dominantSpeakerId !== undefined) {
    card.dataset.speakerid = String(result.dominantSpeakerId);
  }
  card._resultData = result;

  const sourcesHTML = (result.sources ?? []).map((url, i) => {
    const isUrl = url.startsWith('http://') || url.startsWith('https://');
    return isUrl
      ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">Fuente ' + (i + 1) + '</a>'
      : '<span class="rtfc-source-text">' + escapeHtml(url) + '</span>';
  }).join('');

  const lexicalRows = buildLexicalRows(result.lexical);

  let speakerTag = '';
  if (!result.pending && allSpeakersConfirmed() && result.dominantSpeakerId !== null && result.dominantSpeakerId !== undefined) {
    const confirmedName = confirmedSpeakerMap[result.dominantSpeakerId];
    if (confirmedName) {
      const name  = normalizeSpeakerName(confirmedName);
      const color = getSpeakerColor(name);
      speakerTag = '<div class="rtfc-speaker-tag" style="background:' + color + '">' + escapeHtml(name) + '</div>';
    }
  }

  card.innerHTML = [
    speakerTag,
    '<div class="rtfc-verdict-header">',
      '<span class="rtfc-badge rtfc-badge--' + color + '">' + escapeHtml(verdictLabel(result.verdict)) + '</span>',
      result.pending ? '<span class="rtfc-verifying">⟳ verificando...</span>' : '',
      '<span class="rtfc-confidence-right">' + escapeHtml(result.confidence) + ' certeza</span>',
      '<span class="rtfc-timestamp">' + escapeHtml(result._timestamp || '') + '</span>',
    '</div>',
    '<p class="rtfc-claim">"' + escapeHtml(result.claim) + '"</p>',
    '<p class="rtfc-explanation">' + escapeHtml(result.explanation) + '</p>',
    '<div class="rtfc-speaker-confidence">',
      '<button class="rtfc-speaker-toggle">',
        '<span class="rtfc-speaker-dot rtfc-speaker-dot--' + convictionColor + '"></span>',
        'Convicción del hablante: ' + escapeHtml(result.speaker_confidence || 'N/D'),
        '<span class="rtfc-speaker-arrow">▾</span>',
      '</button>',
      '<div class="rtfc-speaker-explanation" style="display:none">',
        lexicalRows,
      '</div>',
    '</div>',
    (sourcesHTML && sourcesHTML.trim()) ? '<div class="rtfc-sources">' + sourcesHTML + '</div>' : '',
  ].join('');

  const toggleBtn = card.querySelector('.rtfc-speaker-toggle');
  const reasons   = card.querySelector('.rtfc-speaker-explanation');
  const arrow     = card.querySelector('.rtfc-speaker-arrow');
  toggleBtn.addEventListener('click', () => {
    const open = reasons.style.display === 'none';
    reasons.style.display = open ? 'block' : 'none';
    arrow.textContent     = open ? '▴' : '▾';
  });

  return card;
}

function findPendingCard(claim, fastClaim) {
  if (fastClaim) {
    const fastKey = fastClaim.toLowerCase().slice(0, 40);
    if (pendingCards.has(fastKey)) return pendingCards.get(fastKey);
  }

  const key = claim.toLowerCase().slice(0, 40);
  if (pendingCards.has(key)) return pendingCards.get(key);

  const claimWords = new Set(claim.toLowerCase().split(/\s+/).filter(w => w.length >= 4));
  let bestCard = null, bestScore = 0;
  for (const [cardKey, card] of pendingCards) {
    const cardWords = cardKey.split(/\s+/).filter(w => w.length >= 4);
    const overlap   = cardWords.filter(w => claimWords.has(w)).length;
    const score     = overlap / Math.max(claimWords.size, cardWords.length);
    if (score > bestScore) { bestScore = score; bestCard = card; }
  }
  if (bestScore >= 0.4) return bestCard;
  return verdictListEl?.querySelector('.rtfc-verdict--pending');
}

function getVideoTimestamp() {
  const video = document.querySelector('video');
  if (!video) return '';
  const s   = Math.floor(video.currentTime);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
  return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}

function getClaimTimestamp(claim) {
  if (!sentenceTimestamps.length) return lastTranscriptTimestamp || getVideoTimestamp();
  const claimWords = new Set(claim.toLowerCase().split(/\s+/).filter(w => w.length >= 4));
  let bestMatch = null, bestScore = 0;
  for (const entry of sentenceTimestamps) {
    const sentWords = entry.text.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    const overlap   = sentWords.filter(w => claimWords.has(w)).length;
    const score     = overlap / Math.max(claimWords.size, sentWords.length);
    if (score > bestScore) { bestScore = score; bestMatch = entry; }
  }
  return bestScore >= 0.3 ? bestMatch.timestamp : (lastTranscriptTimestamp || getVideoTimestamp());
}

function addVerdict(result) {
  if (!verdictListEl) return;
  verdictListEl.querySelector('.rtfc-empty')?.remove();
  applyVerdictToBullet(result.claim, result.verdict, result.confidence);
  if (!result._timestamp) result._timestamp = getClaimTimestamp(result.claim);
  if (result.dominantSpeakerId !== null && result.dominantSpeakerId !== undefined) {
    result.dominantSpeakerId = String(result.dominantSpeakerId);
  }
  const card = buildCard(result);
  if (result.pending) {
    const key = result.claim.toLowerCase().slice(0, 40);
    pendingCards.set(key, card);
    pendingCardTimes.set(key, Date.now());
  } else {
    logVerdict(result);
  }
  verdictListEl.prepend(card);
}

function updateVerdict(result) {
  const existing = findPendingCard(result.claim, result._fastClaim);
  if (existing && existing._resultData?._timestamp) {
    result._timestamp = existing._resultData._timestamp;
  } else if (!result._timestamp) {
    result._timestamp = getClaimTimestamp(result.claim);
  }
  if (result.dominantSpeakerId !== null && result.dominantSpeakerId !== undefined) {
    result.dominantSpeakerId = String(result.dominantSpeakerId);
  }
  const newCard = buildCard(result);
  if (existing) {
    existing.replaceWith(newCard);
    for (const [k, v] of pendingCards) {
      if (v === existing) { pendingCards.delete(k); pendingCardTimes.delete(k); break; }
    }
  } else {
    verdictListEl?.querySelector('.rtfc-empty')?.remove();
    verdictListEl?.prepend(newCard);
  }
  applyVerdictToBullet(result.claim, result.verdict, result.confidence);
  logVerdict(result);
}

function makeDraggable(panel) {
  const header = panel.querySelector('#rtfc-header');
  let isDragging = false, startX, startY, startLeft, startTop;
  header.addEventListener('mousedown', (e) => {
    if (e.target.id === 'rtfc-close' || e.target.id === 'rtfc-export') return;
    isDragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    startLeft = rect.left; startTop = rect.top;
    header.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.right = 'unset';
    panel.style.left  = Math.max(0, startLeft + e.clientX - startX) + 'px';
    panel.style.top   = Math.max(0, startTop  + e.clientY - startY) + 'px';
  });
  document.addEventListener('mouseup', () => { isDragging = false; header.style.cursor = 'grab'; });
}

// ── Mensajes del runtime ──────────────────────────────────────────────────────

if (!window.__intruthChileLoaded) {
window.__intruthChileLoaded = true;

chrome.runtime.onMessage.addListener((msg) => {
  console.log('[overlay] mensaje recibido:', msg.type);
  switch (msg.type) {

    case 'START_FACTCHECK':
      createPanel();
      startSession();
      speakers = parseSpeakersFromTitle(document.title || '');
      speakerColorMap.clear();
      chrome.runtime.sendMessage({
        type:  'PAGE_TITLE',
        title: document.title || '',
        date:  (() => {
          const el = document.querySelector('meta[itemprop="uploadDate"]') ||
                     document.querySelector('meta[property="og:updated_time"]');
          return el ? new Date(el.content).toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
        })(),
      });
      renderSpeakerEditor();
      break;

    case 'STOP_FACTCHECK':
      stopSession();
      removePanel();
      break;

    case 'TRANSCRIPT_RESULT':
      if (msg.interim) {
        updateInterim(msg.text);
      } else if (msg.isFinal) {
        const ts = getVideoTimestamp();
        lastTranscriptTimestamp = ts;
        sentenceTimestamps.push({ text: msg.text, timestamp: ts });
        if (sentenceTimestamps.length > MAX_TIMESTAMP_BUFFER) sentenceTimestamps.shift();
        clearInterim();
        // quitar prefijo [Hablante N] antes de mostrar
        const displayText = msg.text.replace(/^\[.*?\]\s*/, '');
        addTranscriptText(displayText);
        const labelMatch = msg.text.match(/^\[(.+?)\]/);
        if (labelMatch && speakers.includes(labelMatch[1])) {
          lastActiveSpeaker = labelMatch[1];
        }
      }
      break;

    case 'NEW_SPEAKER':
      if (panel) showSpeakerBanner(msg.speakerId, msg.sample || '');
      break;

    case 'PIPELINE_ERROR':
      showError(msg.message || 'Ocurrió un error en el pipeline de fact-checking.');
      break;

    case 'NEW_VERDICT':
      if (msg.results) {
        for (const result of msg.results) {
          addClaimBullet(result.claim);
          addVerdict(result);
        }
      }
      break;

    case 'UPDATE_VERDICTS':
      if (msg.results) {
        for (const result of msg.results) {
          updateVerdict(result);
        }
      }
      break;
  }
});

} // fin guard __intruthChileLoaded
