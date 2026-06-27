// offscreen.js — InTruth Chile
// Captura audio de la pestaña y lo transmite a Deepgram WebSocket.

let deepgramKey = '';
let mediaStream  = null;
let audioContext = null;
let processor    = null;
let socket       = null;
let active       = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    deepgramKey = msg.deepgramKey || '';
    startCapture(msg.streamId, msg.language || 'es')
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.error('[offscreen] error:', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (msg.type === 'STOP_CAPTURE') {
    stopCapture();
    sendResponse({ ok: true });
  }
});

let utteranceBuffer       = '';
let utteranceSpeakerCounts = {};

async function startCapture(streamId, language = 'es') {
  if (active) stopCapture();
  active = true;

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource:   'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  socket = new WebSocket(
    'wss://api.deepgram.com/v1/listen?' + [
      'encoding=linear16',
      'sample_rate=16000',
      'channels=1',
      'model=nova-2',
      'language=' + language,
      'punctuate=true',
      'interim_results=true',
      'utterance_end_ms=2500',
      'smart_format=true',
      'vad_events=true',
      'diarize=true',
    ].join('&'),
    ['token', deepgramKey]
  );

  socket.onopen = () => {
    console.log('[offscreen] deepgram conectado');
    startAudioPipeline();
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'UtteranceEnd') {
        chrome.runtime.sendMessage({ type: 'UTTERANCE_END' });
        return;
      }

      const result = data.channel?.alternatives?.[0];
      if (!result || !result.transcript) return;

      const text    = result.transcript.trim();
      const isFinal = data.is_final;
      const speech  = data.speech_final;

      if (result.words?.length) {
        result.words.forEach(w => {
          if (w.speaker !== null && w.speaker !== undefined) {
            utteranceSpeakerCounts[w.speaker] = (utteranceSpeakerCounts[w.speaker] || 0) + 1;
          }
        });
      }

      function getDominantSpeaker() {
        const entries = Object.entries(utteranceSpeakerCounts);
        if (!entries.length) return null;
        return parseInt(entries.sort((a, b) => b[1] - a[1])[0][0]);
      }

      if (!text) return;

      if (isFinal && speech) {
        const fullText = utteranceBuffer ? utteranceBuffer + ' ' + text : text;
        const speaker  = getDominantSpeaker();
        utteranceBuffer = '';
        utteranceSpeakerCounts = {};
        chrome.runtime.sendMessage({
          type:    'TRANSCRIPT_RESULT',
          text:    fullText.trim(),
          isFinal: true,
          interim: false,
          speaker,
        });
      } else if (isFinal && !speech) {
        utteranceBuffer += (utteranceBuffer ? ' ' : '') + text;
        chrome.runtime.sendMessage({
          type:    'TRANSCRIPT_RESULT',
          text:    utteranceBuffer,
          isFinal: false,
          interim: true,
          speaker: getDominantSpeaker(),
        });
      } else {
        chrome.runtime.sendMessage({
          type:    'TRANSCRIPT_RESULT',
          text,
          isFinal: false,
          interim: true,
          speaker: getDominantSpeaker(),
        });
      }

    } catch (err) {
      console.error('[offscreen] error procesando mensaje:', err);
    }
  };

  socket.onerror = (err) => {
    console.error('[offscreen] deepgram error:', err);
    chrome.runtime.sendMessage({ type: 'PIPELINE_ERROR', message: 'Error de transcripción — verifica tu Deepgram key.' }).catch(() => {});
  };

  socket.onclose = (e) => {
    console.log('[offscreen] deepgram cerrado:', e.code, e.reason);
    if (e.code === 1008 || e.code === 1011) {
      chrome.runtime.sendMessage({ type: 'PIPELINE_ERROR', message: 'Conexión Deepgram fallida (código ' + e.code + '). Verifica tu API key.' }).catch(() => {});
      return;
    }
    if (active) {
      chrome.runtime.sendMessage({ type: 'PIPELINE_ERROR', message: 'Transcripción desconectada — reconectando...' }).catch(() => {});
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'REQUEST_NEW_STREAM' }).catch(() => {});
      }, 1000);
    }
  };
}

function startAudioPipeline() {
  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);

  source.connect(audioContext.destination);

  processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (socket?.readyState !== WebSocket.OPEN) return;

    const float32 = e.inputBuffer.getChannelData(0);
    const int16   = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
    }
    socket.send(int16.buffer);
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
  console.log('[offscreen] pipeline de audio iniciado');
}

function stopCapture() {
  active = false;
  utteranceBuffer       = '';
  utteranceSpeakerCounts = {};

  if (socket)       { socket.close();    socket = null; }
  if (processor)    { processor.disconnect(); processor = null; }
  if (mediaStream)  { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }

  console.log('[offscreen] detenido');
}
