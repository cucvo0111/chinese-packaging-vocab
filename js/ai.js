// Optional AI vocabulary generation. Calls the Anthropic Messages API
// directly from the browser using a user-supplied API key (stored only in
// this device's localStorage, via DB.updateSettings). This requires the
// official "direct browser access" opt-in header - Anthropic explicitly
// supports it for personal / prototype use, with the caveat that anyone who
// can read this browser's storage/network traffic can read the key. That's
// an acceptable trade-off for a single-user personal study app, but the key
// should never be reused for anything else. See Settings for the warning
// shown to the user before they paste a key in.
const AI = (() => {
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const PRIORITY_ORDER = [
    'production-process', 'raw-materials', 'pe', 'pet', 'pa-nylon', 'pp', 'cpp', 'film',
    'quality-control', 'packaging-defects', 'testing',
    'customer-specifications', 'international-sales', 'negotiation', 'quotations',
    'shipping-export', 'general-business-chinese',
  ];

  // Pure client-side gap analysis: no API call. Ranks categories by "most
  // under-represented relative to how important they are" using the fixed
  // priority order from the spec, then by raw word count ascending.
  function analyzeGaps(pool, categories) {
    const counts = {};
    categories.forEach(function (c) { counts[c.id] = 0; });
    pool.forEach(function (w) { counts[w.category] = (counts[w.category] || 0) + 1; });
    const ranked = categories.slice().sort(function (a, b) {
      const pa = PRIORITY_ORDER.indexOf(a.id); const pb = PRIORITY_ORDER.indexOf(b.id);
      const priorityDiff = (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
      if (priorityDiff !== 0) return priorityDiff;
      return (counts[a.id] || 0) - (counts[b.id] || 0);
    });
    return ranked.map(function (c) { return { id: c.id, vi: c.vi, count: counts[c.id] || 0 }; });
  }

  function vocabTool(categoryIds) {
    return {
      name: 'add_vocabulary',
      description: 'Adds newly generated Chinese flexible-packaging-industry vocabulary entries.',
      input_schema: {
        type: 'object',
        properties: {
          words: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                chinese: { type: 'string' },
                pinyin: { type: 'string' },
                vietnamese: { type: 'string', description: 'Vietnamese meaning, may include a short parenthetical explanation' },
                english: { type: 'string' },
                partOfSpeech: { type: 'string' },
                category: { type: 'string', enum: categoryIds },
                difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
                example: { type: 'string', description: 'One natural Chinese example sentence using the word in a packaging-industry context' },
                exampleTranslation: { type: 'string', description: 'Vietnamese translation of the example sentence' },
                notes: { type: 'string' },
              },
              required: ['chinese', 'pinyin', 'vietnamese', 'category', 'difficulty', 'example', 'exampleTranslation'],
            },
          },
        },
        required: ['words'],
      },
    };
  }

  function buildSystemPrompt(focusCategories) {
    const focusList = focusCategories.map(function (c) { return c.vi + ' (' + c.id + ')'; }).join(', ');
    return [
      'Ban la tro ly xay dung tu vung tieng Trung chuyen nganh bao bi nhua mem (flexible packaging) cho mot nhan vien kinh doanh xuat khau nguoi Viet Nam lam viec voi cac nha may Trung Quoc.',
      'Uu tien tu vung thuc te, huu ich trong cong viec hang ngay: san xuat, nguyen vat lieu, quy trinh, kiem soat chat luong, loi bao bi, kiem nghiem, quy cach khach hang, ban hang quoc te, dam phan, tieng Trung thuong mai.',
      'KHONG tao tu vung HSK pho thong chung chung, chi tao tu chuyen nganh bao bi / thuong mai thuc su huu ich.',
      'Uu tien dac biet cho cac danh muc dang thieu tu vung sau: ' + focusList + '.',
      'Moi tu phai co vi du cau tieng Trung thuc te trong boi canh nganh bao bi, kem ban dich tieng Viet.',
      'Tuyet doi khong lap lai bat ky tu nao trong danh sach tu da co duoc cung cap.',
      'Tra ve ket qua CHI thong qua viec goi cong cu add_vocabulary, khong viet van ban giai thich them.',
    ].join(' ');
  }

  // opts: { apiKey, model, count, focusCategories, existingChineseWords, categoryIds }
  async function generateVocabulary(opts) {
    if (!opts.apiKey) throw new Error('Chua nhap Anthropic API key trong Cai dat.');
    const existingSample = opts.existingChineseWords.slice(-1500).join('、');
    const userMsg = 'Hay tao ' + opts.count + ' tu vung moi (khong trung voi danh sach da co).\n' +
      'Danh sach tu da co (khong duoc lap lai): ' + existingSample;

    const body = {
      model: opts.model || 'claude-haiku-4-5',
      max_tokens: 8000,
      system: buildSystemPrompt(opts.focusCategories || []),
      messages: [{ role: 'user', content: userMsg }],
      tools: [vocabTool(opts.categoryIds)],
      tool_choice: { type: 'tool', name: 'add_vocabulary' },
    };

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error('Khong the ket noi den Anthropic API (kiem tra mang / CORS): ' + e.message);
    }

    const data = await res.json().catch(function () { return null; });
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
      throw new Error('Loi API: ' + msg);
    }
    const toolUse = (data.content || []).find(function (b) { return b.type === 'tool_use'; });
    if (!toolUse || !toolUse.input || !Array.isArray(toolUse.input.words)) {
      throw new Error('Khong nhan duoc du lieu tu vung hop le tu API.');
    }
    return toolUse.input.words;
  }

  return { analyzeGaps: analyzeGaps, generateVocabulary: generateVocabulary, PRIORITY_ORDER: PRIORITY_ORDER };
})();
