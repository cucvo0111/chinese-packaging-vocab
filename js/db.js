// Storage layer: merges the shipped base vocab (immutable, cached by the
// service worker) with locally-imported words, and persists per-word SRS /
// progress state separately so re-importing or updating the app never wipes
// study history. Everything lives in localStorage.
const DB = (() => {
  const LS_CUSTOM = 'cpv_custom_vocab_v1';
  const LS_PROGRESS = 'cpv_progress_v1';
  const LS_SETTINGS = 'cpv_settings_v1';
  const LS_STUDY_LOG = 'cpv_study_log_v1';

  let baseVocab = [];
  let customVocab = [];
  let categories = [];
  let progress = {};
  let settings = {};
  let studyLog = {};
  let merged = [];

  function todayStr(d) {
    d = d || new Date();
    return d.toISOString().slice(0, 10);
  }

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('DB: failed to parse', key, e);
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.error('DB: failed to save', key, e); }
  }

  function defaultProgressFor(word) {
    return {
      reviewStatus: word.reviewStatus || 'new',
      interval: word.interval || 0,
      dueDate: word.dueDate || word.dateAdded || todayStr(),
      reviewCount: word.reviewCount || 0,
      correctCount: word.correctCount || 0,
      incorrectCount: word.incorrectCount || 0,
      favorite: !!word.favorite,
    };
  }

  function applyProgress() {
    merged = baseVocab.concat(customVocab).map(function (w) {
      const p = progress[w.id] || defaultProgressFor(w);
      return Object.assign({}, w, p);
    });
  }

  async function init() {
    const vocabRes = await fetch('data/vocab-base.json').then(function (r) { return r.json(); }).catch(function () { return []; });
    const catRes = await fetch('data/categories.json').then(function (r) { return r.json(); }).catch(function () { return []; });
    baseVocab = vocabRes;
    categories = catRes;
    customVocab = loadJSON(LS_CUSTOM, []);
    progress = loadJSON(LS_PROGRESS, {});
    settings = loadJSON(LS_SETTINGS, {
      dailyNewLimit: 30, streak: 0, lastStudyDate: null,
      totalStudyDays: 0, studyDaysSet: [], apiKey: '', aiModel: 'claude-haiku-4-5',
    });
    studyLog = loadJSON(LS_STUDY_LOG, {});

    let changed = false;
    for (const w of baseVocab.concat(customVocab)) {
      if (!progress[w.id]) { progress[w.id] = defaultProgressFor(w); changed = true; }
    }
    if (changed) saveJSON(LS_PROGRESS, progress);
    applyProgress();
  }

  function all() { return merged; }
  function getCategories() { return categories; }
  function byId(id) { return merged.find(function (w) { return w.id === id; }); }
  function normalizeChinese(s) { return (s || '').trim(); }

  function existsByChinese(chinese) {
    const norm = normalizeChinese(chinese);
    return merged.some(function (w) { return normalizeChinese(w.chinese) === norm; });
  }

  function nextCustomId() {
    const nums = baseVocab.concat(customVocab)
      .map(function (w) { return parseInt(String(w.id).replace(/\D/g, ''), 10); })
      .filter(function (n) { return !isNaN(n); });
    const max = nums.length ? Math.max.apply(null, nums) : 0;
    return 'w' + String(max + 1).padStart(4, '0');
  }

  // Adds one normalized word object if not a duplicate (by Chinese text).
  function addWord(partial) {
    const chinese = normalizeChinese(partial.chinese);
    if (!chinese) return { added: false, reason: 'empty' };
    const dup = merged.find(function (w) { return normalizeChinese(w.chinese) === chinese; });
    if (dup) return { added: false, reason: 'duplicate', word: dup };

    const id = nextCustomId();
    const word = {
      id: id,
      chinese: chinese,
      pinyin: partial.pinyin || '',
      vietnamese: partial.vietnamese || '',
      english: partial.english || '',
      partOfSpeech: partial.partOfSpeech || 'danh từ',
      category: partial.category || 'general-business-chinese',
      difficulty: partial.difficulty || 'medium',
      hsk: partial.hsk || null,
      example: partial.example || '',
      exampleTranslation: partial.exampleTranslation || '',
      related: partial.related || [],
      synonyms: partial.synonyms || [],
      antonyms: partial.antonyms || [],
      notes: partial.notes || '',
      dateAdded: partial.dateAdded || todayStr(),
    };
    customVocab.push(word);
    progress[id] = defaultProgressFor({ dateAdded: word.dateAdded });
    saveJSON(LS_CUSTOM, customVocab);
    saveJSON(LS_PROGRESS, progress);
    applyProgress();
    return { added: true, word: word };
  }

  function updateProgress(id, patch) {
    const cur = progress[id] || defaultProgressFor({});
    progress[id] = Object.assign({}, cur, patch);
    saveJSON(LS_PROGRESS, progress);
    applyProgress();
  }

  function toggleFavorite(id) {
    const cur = progress[id] || defaultProgressFor({});
    updateProgress(id, { favorite: !cur.favorite });
  }

  function logStudyEvent(correct) {
    const day = todayStr();
    if (!studyLog[day]) studyLog[day] = { reviews: 0, correct: 0 };
    studyLog[day].reviews += 1;
    if (correct) studyLog[day].correct += 1;
    saveJSON(LS_STUDY_LOG, studyLog);
    bumpStreak(day);
  }

  function bumpStreak(day) {
    if (settings.lastStudyDate === day) return;
    const yesterday = todayStr(new Date(Date.now() - 86400000));
    if (settings.lastStudyDate === yesterday) {
      settings.streak = (settings.streak || 0) + 1;
    } else {
      settings.streak = 1;
    }
    settings.lastStudyDate = day;
    if (!settings.studyDaysSet) settings.studyDaysSet = [];
    if (settings.studyDaysSet.indexOf(day) === -1) {
      settings.studyDaysSet.push(day);
      settings.totalStudyDays = settings.studyDaysSet.length;
    }
    saveJSON(LS_SETTINGS, settings);
  }

  function getSettings() { return settings; }
  function updateSettings(patch) {
    settings = Object.assign({}, settings, patch);
    saveJSON(LS_SETTINGS, settings);
  }
  function getStudyLog() { return studyLog; }

  function last7DaysActivity() {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = todayStr(new Date(Date.now() - i * 86400000));
      const entry = studyLog[d] || { reviews: 0, correct: 0 };
      out.push({ date: d, reviews: entry.reviews, correct: entry.correct });
    }
    return out;
  }

  function exportBackup() {
    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      customVocab: customVocab,
      progress: progress,
      settings: settings,
      studyLog: studyLog,
    };
  }

  function importBackup(data, opts) {
    opts = opts || { merge: true };
    if (!data || typeof data !== 'object') throw new Error('Invalid backup file');
    if (opts.merge) {
      const existingIds = {};
      customVocab.forEach(function (w) { existingIds[w.id] = true; });
      (data.customVocab || []).forEach(function (w) {
        if (!existingIds[w.id] && !existsByChinese(w.chinese)) customVocab.push(w);
      });
      progress = Object.assign({}, progress, data.progress || {});
      studyLog = Object.assign({}, studyLog, data.studyLog || {});
      settings = Object.assign({}, settings, data.settings || {});
    } else {
      customVocab = data.customVocab || [];
      progress = data.progress || {};
      studyLog = data.studyLog || {};
      settings = Object.assign({}, settings, data.settings || {});
    }
    saveJSON(LS_CUSTOM, customVocab);
    saveJSON(LS_PROGRESS, progress);
    saveJSON(LS_STUDY_LOG, studyLog);
    saveJSON(LS_SETTINGS, settings);
    applyProgress();
  }

  function csvEscape(v) {
    const s = (v === null || v === undefined) ? '' : String(v);
    if (/[,\n]/.test(s) || s.indexOf(String.fromCharCode(34)) !== -1) {
      return String.fromCharCode(34) + s.split(String.fromCharCode(34)).join(String.fromCharCode(34, 34)) + String.fromCharCode(34);
    }
    return s;
  }

  function exportVocabCSV() {
    const header = ['chinese', 'pinyin', 'vietnamese', 'english', 'category', 'example', 'exampleTranslation', 'partOfSpeech', 'difficulty', 'hsk', 'dateAdded'];
    const rows = merged.map(function (w) {
      return header.map(function (h) { return csvEscape(w[h]); }).join(',');
    });
    return [header.join(',')].concat(rows).join('\n');
  }

  return {
    init: init, all: all, getCategories: getCategories, byId: byId,
    existsByChinese: existsByChinese, addWord: addWord,
    updateProgress: updateProgress, toggleFavorite: toggleFavorite,
    logStudyEvent: logStudyEvent, getSettings: getSettings,
    updateSettings: updateSettings, getStudyLog: getStudyLog,
    last7DaysActivity: last7DaysActivity, exportBackup: exportBackup,
    importBackup: importBackup, exportVocabCSV: exportVocabCSV, todayStr: todayStr,
  };
})();
