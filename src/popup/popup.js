// popup.js — InTruth Chile

const toggleBtn    = document.getElementById('toggleBtn');
const statusEl     = document.getElementById('status');
const anthropicEl  = document.getElementById('anthropicKey');
const deepgramEl   = document.getElementById('deepgramKey');
const serperEl     = document.getElementById('serperKey');
const keyHint      = document.getElementById('keyHint');
const keysSection  = document.getElementById('keysSection');
const languageEl   = document.getElementById('languageSelect');
const langFlagEl   = document.getElementById('langFlag');

const LANG_FLAGS = {
  es: '🇨🇱', en: '🇺🇸', pt: '🇧🇷',
  fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹',
};

function updateFlag() {
  langFlagEl.textContent = LANG_FLAGS[languageEl.value] || '🌐';
}

let isActive = false;

// ── Cargar keys guardadas ─────────────────────────────────────────────────────

chrome.storage.local.get(['anthropicKey', 'deepgramKey', 'serperKey', 'transcriptLanguage'], (data) => {
  if (data.anthropicKey) { anthropicEl.value = data.anthropicKey; anthropicEl.classList.add('saved'); }
  if (data.deepgramKey)  { deepgramEl.value  = data.deepgramKey;  deepgramEl.classList.add('saved'); }
  if (data.serperKey)    { serperEl.value    = data.serperKey;    serperEl.classList.add('saved'); }
  if (data.transcriptLanguage) languageEl.value = data.transcriptLanguage;
  updateFlag();
  updateHint();
});

// ── Guardar keys al cambiar ───────────────────────────────────────────────────

anthropicEl.addEventListener('input',  () => { anthropicEl.classList.remove('saved'); updateHint(); });
anthropicEl.addEventListener('change', () => {
  chrome.storage.local.set({ anthropicKey: anthropicEl.value.trim() });
  anthropicEl.classList.add('saved');
  updateHint();
});

deepgramEl.addEventListener('input',  () => { deepgramEl.classList.remove('saved'); updateHint(); });
deepgramEl.addEventListener('change', () => {
  chrome.storage.local.set({ deepgramKey: deepgramEl.value.trim() });
  deepgramEl.classList.add('saved');
  updateHint();
});

serperEl.addEventListener('input',  () => { serperEl.classList.remove('saved'); });
serperEl.addEventListener('change', () => {
  chrome.storage.local.set({ serperKey: serperEl.value.trim() });
  serperEl.classList.add('saved');
});

languageEl.addEventListener('change', () => {
  chrome.storage.local.set({ transcriptLanguage: languageEl.value });
  updateFlag();
});

function updateHint() {
  const hasAnthropic = !!anthropicEl.value.trim();
  const hasDeepgram  = !!deepgramEl.value.trim();

  if (!hasAnthropic && !hasDeepgram) {
    keyHint.textContent = 'Ingresa tu Anthropic key y Deepgram key para comenzar.';
    keyHint.className   = 'key-hint';
    if (!isActive) toggleBtn.disabled = true;
  } else if (!hasAnthropic) {
    keyHint.textContent = 'Falta la Anthropic key.';
    keyHint.className   = 'key-hint error';
    if (!isActive) toggleBtn.disabled = true;
  } else if (!hasDeepgram) {
    keyHint.textContent = 'Falta la Deepgram key.';
    keyHint.className   = 'key-hint error';
    if (!isActive) toggleBtn.disabled = true;
  } else {
    keyHint.textContent = serperEl.value.trim()
      ? 'Keys listas. Búsqueda web activa.'
      : 'Keys listas. Sin Serper: sin búsqueda web.';
    keyHint.className   = 'key-hint ok';
    toggleBtn.disabled  = false;
  }
}

// ── Estado inicial ────────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  if (res?.isCapturing) setActive(true);
});

function setActive(active) {
  isActive = active;
  toggleBtn.textContent = active ? 'Detener Fact-Checking' : 'Iniciar Fact-Checking';
  toggleBtn.className   = 'toggle-btn' + (active ? ' active' : '');
  statusEl.textContent  = active ? 'En vivo • Fact-checking activo' : 'Inactivo';
  statusEl.className    = 'status' + (active ? ' active' : '');
  keysSection.style.display = active ? 'none' : 'flex';
  if (!active) updateHint();
}

// ── Botón toggle ──────────────────────────────────────────────────────────────

toggleBtn.addEventListener('click', async () => {
  if (isActive) {
    chrome.runtime.sendMessage({ type: 'STOP_FACTCHECK' });
    setActive(false);
    return;
  }

  const anthropicKey = anthropicEl.value.trim();
  const deepgramKey  = deepgramEl.value.trim();
  const serperKey    = serperEl.value.trim();

  if (!anthropicKey) {
    keyHint.textContent = 'Por favor ingresa tu Anthropic API key.';
    keyHint.className   = 'key-hint error';
    return;
  }
  if (!deepgramKey) {
    keyHint.textContent = 'Por favor ingresa tu Deepgram API key.';
    keyHint.className   = 'key-hint error';
    return;
  }

  // guardar todas las keys antes de iniciar
  await new Promise(r => chrome.storage.local.set(
    { anthropicKey, deepgramKey, serperKey, transcriptLanguage: languageEl.value }, r
  ));

  chrome.runtime.sendMessage({ type: 'START_FACTCHECK' }, (res) => {
    if (res?.ok) {
      setActive(true);
    } else {
      keyHint.textContent = 'Error al iniciar: ' + (res?.error || 'error desconocido');
      keyHint.className   = 'key-hint error';
    }
  });
});
