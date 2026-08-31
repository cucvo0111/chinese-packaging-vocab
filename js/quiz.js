// Generates one question at a time for each of the 6 quiz modes. Distractors
// are preferentially drawn from the same packaging category so options stay
// meaningfully close (harder, more realistic quiz) rather than trivially
// different domains.
const Quiz = (() => {
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pickDistractors(pool, target, count, keyFn) {
    const sameCategory = pool.filter(function (w) { return w.id !== target.id && w.category === target.category; });
    const rest = pool.filter(function (w) { return w.id !== target.id && w.category !== target.category; });
    const chosen = [];
    const seenKeys = {};
    seenKeys[keyFn(target)] = true;
    function tryAdd(list) {
      for (const w of shuffle(list)) {
        if (chosen.length >= count) break;
        const k = keyFn(w);
        if (seenKeys[k]) continue;
        seenKeys[k] = true;
        chosen.push(w);
      }
    }
    tryAdd(sameCategory);
    tryAdd(rest);
    return chosen;
  }

  function buildMC(target, pool, count, mainKeyFn, labelFn) {
    const distractors = pickDistractors(pool, target, count - 1, mainKeyFn);
    const options = shuffle([target].concat(distractors)).map(function (w) {
      return { id: w.id, label: labelFn(w), correct: w.id === target.id };
    });
    return options;
  }

  function pickTarget(pool) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // mode 1: Chinese -> Vietnamese
  function zhToVi(pool) {
    const eligible = pool.filter(function (w) { return w.vietnamese; });
    const target = pickTarget(eligible);
    const options = buildMC(target, eligible, 4, function (w) { return w.vietnamese; }, function (w) { return w.vietnamese; });
    return { mode: 'zh-vi', prompt: target.chinese, sub: target.pinyin, options: options, target: target };
  }

  // mode 2: Vietnamese -> Chinese
  function viToZh(pool) {
    const eligible = pool.filter(function (w) { return w.vietnamese; });
    const target = pickTarget(eligible);
    const options = buildMC(target, eligible, 4, function (w) { return w.chinese; }, function (w) { return w.chinese; });
    return { mode: 'vi-zh', prompt: target.vietnamese, sub: '', options: options, target: target };
  }

  // mode 3: Pinyin -> Hanzi
  function pinyinToHanzi(pool) {
    const eligible = pool.filter(function (w) { return w.pinyin; });
    const target = pickTarget(eligible);
    const options = buildMC(target, eligible, 4, function (w) { return w.chinese; }, function (w) { return w.chinese; });
    return { mode: 'pinyin-hanzi', prompt: target.pinyin, sub: '', options: options, target: target };
  }

  // mode 4: Listening - TTS speaks the word, choose the matching meaning
  function listening(pool) {
    const eligible = pool.filter(function (w) { return w.vietnamese; });
    const target = pickTarget(eligible);
    const options = buildMC(target, eligible, 4, function (w) { return w.vietnamese; }, function (w) { return w.vietnamese; });
    return { mode: 'listening', prompt: '🔊', speak: target.chinese, sub: '', options: options, target: target };
  }

  // mode 5: Fill in the blank using the word's own example sentence
  function fillBlank(pool) {
    const eligible = pool.filter(function (w) { return w.example && w.example.indexOf(w.chinese) !== -1; });
    if (!eligible.length) return null;
    const target = pickTarget(eligible);
    const blanked = target.example.split(target.chinese).join('______');
    const options = buildMC(target, eligible, 4, function (w) { return w.chinese; }, function (w) { return w.chinese; });
    return { mode: 'fill-blank', prompt: blanked, sub: target.exampleTranslation || '', options: options, target: target };
  }

  // mode 6: Business situation - Vietnamese scenario -> pick the matching Chinese line
  function businessSituation(dialogues) {
    const allLines = [];
    dialogues.forEach(function (d) {
      d.lines.forEach(function (l) { allLines.push({ zh: l.zh, vi: l.vi, scenario: d.scenario, role: l.role }); });
    });
    if (allLines.length < 4) return null;
    const target = allLines[Math.floor(Math.random() * allLines.length)];
    const others = shuffle(allLines.filter(function (l) { return l.zh !== target.zh; })).slice(0, 3);
    const options = shuffle([target].concat(others)).map(function (l) {
      return { id: l.zh, label: l.zh, correct: l.zh === target.zh };
    });
    return {
      mode: 'business',
      prompt: target.vi,
      sub: target.scenario + ' — ' + target.role,
      options: options,
      target: target,
    };
  }

  const MODES = {
    'zh-vi': { fn: zhToVi, name: 'Hán tự → Nghĩa', icon: '🀄', desc: 'Chọn nghĩa tiếng Việt đúng' },
    'vi-zh': { fn: viToZh, name: 'Nghĩa → Hán tự', icon: '🇻🇳', desc: 'Chọn từ Hán tự đúng' },
    'pinyin-hanzi': { fn: pinyinToHanzi, name: 'Pinyin → Hán tự', icon: '🔤', desc: 'Chọn chữ Hán đúng theo pinyin' },
    'listening': { fn: listening, name: 'Nghe hiểu', icon: '🎧', desc: 'Nghe và chọn nghĩa đúng' },
    'fill-blank': { fn: fillBlank, name: 'Điền vào chỗ trống', icon: '📝', desc: 'Chọn từ điền đúng vào câu' },
    'business': { fn: null, name: 'Tình huống thực tế', icon: '💼', desc: 'Chọn câu tiếng Trung phù hợp' },
  };

  function nextQuestion(modeId, pool, dialogues) {
    if (modeId === 'business') return businessSituation(dialogues);
    const mode = MODES[modeId];
    if (!mode || !mode.fn) return null;
    return mode.fn(pool);
  }

  return { MODES: MODES, nextQuestion: nextQuestion };
})();
