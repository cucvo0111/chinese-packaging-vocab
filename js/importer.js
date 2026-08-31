// CSV / JSON import pipeline: normalizes flexible column names, detects
// duplicates against the live merged vocab (DB.existsByChinese), and
// auto-assigns category + difficulty for any row that omits them - the
// same rule-based classifier used to build the original 382-word import,
// so future daily batches from the Claude Project get consistent labels.
const Importer = (() => {
  const VERB_HINTS = ['议价', '报价', '谈判', '检测', '测试', '验货', '装箱', '复卷', '分切', '涂布', '印刷',
    '层压', '复合', '充气', '封口', '抽真空', '蒸煮', '过磅', '报关', '清关', '协商', '沟通', '确认', '签署', '退回', '装船'];

  function classifyCategory(text, categories) {
    for (const cat of categories) {
      if (!cat.keywords || !cat.keywords.length) continue;
      for (const kw of cat.keywords) {
        if (text.indexOf(kw) !== -1) return cat.id;
      }
    }
    return 'general-business-chinese';
  }

  function guessPartOfSpeech(word) {
    for (const v of VERB_HINTS) if (word.indexOf(v) !== -1) return 'động từ';
    return 'danh từ';
  }

  function guessDifficulty(word) {
    const len = Array.from(word || '').length;
    if (len <= 2) return 'easy';
    if (len <= 4) return 'medium';
    return 'hard';
  }

  // Minimal RFC4180-ish CSV parser (handles quoted fields, commas, newlines inside quotes).
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const header = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (r) {
      const obj = {};
      header.forEach(function (h, idx) { obj[h] = (r[idx] || '').trim(); });
      return obj;
    });
  }

  const KEY_MAP = {
    chinese: ['chinese', 'Chinese', 'hanzi', 'Hán tự', 'han tu', '汉字', 'word', 'zh'],
    pinyin: ['pinyin', 'Pinyin'],
    vietnamese: ['vietnamese', 'Vietnamese', 'Nghĩa tiếng Việt', 'nghia', 'meaning_vi', 'vi'],
    english: ['english', 'English', 'meaning_en', 'en'],
    category: ['category', 'Category', 'danh muc', 'loai'],
    partOfSpeech: ['partOfSpeech', 'part_of_speech', 'pos', 'từ loại'],
    difficulty: ['difficulty', 'level'],
    hsk: ['hsk', 'HSK'],
    example: ['example', 'Example', 'Ví dụ', 'vi_du', 'sentence'],
    exampleTranslation: ['exampleTranslation', 'translation', 'Translation', 'example_vi'],
    notes: ['notes', 'Notes', 'ghi chu'],
  };

  function pick(row, keys) {
    for (const k of keys) {
      if (row[k] !== undefined && String(row[k]).trim() !== '') return String(row[k]).trim();
    }
    return '';
  }

  function normalizeRow(row) {
    const out = {};
    for (const field in KEY_MAP) out[field] = pick(row, KEY_MAP[field]);
    // "example" column sometimes carries "中文句。(dịch)" like the original export
    if (out.example && !out.exampleTranslation && out.example.indexOf('(') !== -1) {
      const idx = out.example.indexOf('(');
      let vi = out.example.slice(idx + 1).trim();
      if (vi.endsWith(')')) vi = vi.slice(0, -1).trim();
      out.example = out.example.slice(0, idx).trim();
      out.exampleTranslation = vi;
    }
    return out;
  }

  // rows: array of raw objects (already parsed from CSV or JSON).
  // Returns { toAdd: [...normalized rows ready for DB.addWord], duplicates: [...], invalid: [...] }
  function prepareImport(rows, categories) {
    const toAdd = [], duplicates = [], invalid = [];
    const seenInBatch = {};
    for (const raw of rows) {
      const norm = normalizeRow(raw);
      if (!norm.chinese) { invalid.push(raw); continue; }
      if (seenInBatch[norm.chinese] || DB.existsByChinese(norm.chinese)) {
        duplicates.push(norm);
        continue;
      }
      seenInBatch[norm.chinese] = true;
      if (!norm.category) {
        // headword + meaning only - excluding the example sentence, which
        // often name-drops other materials and would hijack the category.
        const text = norm.chinese + ' ' + norm.vietnamese;
        norm.category = classifyCategory(text, categories);
      }
      if (!norm.partOfSpeech) norm.partOfSpeech = guessPartOfSpeech(norm.chinese);
      if (!norm.difficulty) norm.difficulty = guessDifficulty(norm.chinese);
      toAdd.push(norm);
    }
    return { toAdd: toAdd, duplicates: duplicates, invalid: invalid };
  }

  function commitImport(toAdd) {
    let added = 0;
    for (const row of toAdd) {
      const res = DB.addWord(row);
      if (res.added) added++;
    }
    return added;
  }

  return { parseCSV: parseCSV, normalizeRow: normalizeRow, prepareImport: prepareImport, commitImport: commitImport, classifyCategory: classifyCategory };
})();
