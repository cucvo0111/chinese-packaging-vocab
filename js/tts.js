// Chinese text-to-speech via the Web Speech API. Works fully offline once
// the device's on-device Chinese voice is available (iOS Safari ships
// several Mandarin voices out of the box). Degrades silently if unsupported.
const TTS = (() => {
  const supported = 'speechSynthesis' in window;
  let voices = [];
  let voicesReady = false;

  function loadVoices() {
    if (!supported) return;
    voices = window.speechSynthesis.getVoices();
    if (voices.length) voicesReady = true;
  }

  if (supported) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function pickChineseVoice() {
    if (!voices.length) loadVoices();
    let v = voices.find(function (x) { return /^zh/i.test(x.lang) && /CN/i.test(x.lang); });
    if (!v) v = voices.find(function (x) { return /^zh/i.test(x.lang); });
    return v || null;
  }

  function speak(text, opts) {
    opts = opts || {};
    if (!supported || !text) return false;
    try {
      window.speechSynthesis.cancel(); // avoid overlapping utterances
      const utter = new SpeechSynthesisUtterance(text);
      const voice = pickChineseVoice();
      if (voice) utter.voice = voice;
      utter.lang = voice ? voice.lang : 'zh-CN';
      utter.rate = opts.rate || 0.92;
      utter.pitch = 1;
      window.speechSynthesis.speak(utter);
      return true;
    } catch (e) {
      console.warn('TTS failed', e);
      return false;
    }
  }

  return { speak: speak, isSupported: function () { return supported; } };
})();
