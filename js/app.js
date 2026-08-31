// Main app controller: navigation, rendering, and wiring of DB / SRS / Quiz /
// Importer / TTS / AI / Charts into the UI. Plain vanilla JS, no framework -
// keeps the app small, fast, and fully offline-capable.
(function () {
  'use strict';

  const screens = {};
  let currentScreen = 'home';
  let studyQueue = [];
  let studyIndex = 0;
  let studyFlipped = false;
  let currentQuizMode = null;
  let currentQuestion = null;
  let quizScore = { correct: 0, total: 0 };
  let searchDebounce = null;
  let activeCategoryId = null;
  let dialogues = [];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : (c === '<' ? '&lt;' : '&gt;');
    });
  }

  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = el('div', 'toast'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function categoryById(id) {
    return DB.getCategories().find(function (c) { return c.id === id; }) || { id: id, vi: id, icon: '💬' };
  }

  // ---------------- Navigation ----------------
  function showScreen(id) {
    $all('.screen').forEach(function (s) { s.classList.remove('active'); });
    const s = document.getElementById('screen-' + id);
    if (s) s.classList.add('active');
    currentScreen = id;
    $all('.tab-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === id); });
    window.scrollTo(0, 0);
    if (id === 'home') renderHome();
    if (id === 'categories') renderCategories();
    if (id === 'favorites') renderFavorites();
    if (id === 'difficult') renderDifficult();
    if (id === 'progress') renderProgress();
    if (id === 'search') renderSearch('');
    if (id === 'quiz-menu') renderQuizMenu();
    if (id === 'dialogues') renderDialogues();
    if (id === 'settings') renderSettings();
    if (id === 'more') renderMore();
  }

  // ---------------- Home ----------------
  function renderHome() {
    const pool = DB.all();
    const dueCount = pool.filter(SRS.isDue).filter(function (w) { return w.reviewStatus !== 'new'; }).length;
    const settings = DB.getSettings();
    const newToday = pool.filter(function (w) { return w.reviewStatus === 'new'; }).length;
    const newLimit = settings.dailyNewLimit || 30;
    const mastered = pool.filter(function (w) { return w.reviewStatus === 'mastered'; }).length;
    const learned = pool.filter(function (w) { return w.reviewStatus !== 'new'; }).length;
    const pct = pool.length ? Math.round((learned / pool.length) * 100) : 0;

    $('#home-due').textContent = dueCount;
    $('#home-new').textContent = Math.min(newToday, newLimit);
    $('#home-total').textContent = pool.length;
    $('#home-mastered').textContent = mastered;
    $('#home-streak').textContent = (settings.streak || 0) + ' 🔥';
    $('#home-progress-bar').style.width = pct + '%';
    $('#home-progress-label').textContent = pct + '% (' + learned + '/' + pool.length + ')';
  }

  // ---------------- Study / Flashcards ----------------
  function buildQueue(type) {
    const pool = DB.all();
    const settings = DB.getSettings();
    if (type === 'due') {
      return pool.filter(function (w) { return w.reviewStatus !== 'new' && SRS.isDue(w); })
        .sort(function (a, b) { return (a.dueAt || a.dueDate).localeCompare(b.dueAt || b.dueDate); });
    }
    if (type === 'new') {
      return pool.filter(function (w) { return w.reviewStatus === 'new'; })
        .sort(function (a, b) { return a.dateAdded.localeCompare(b.dateAdded) || a.id.localeCompare(b.id); })
        .slice(0, settings.dailyNewLimit || 30);
    }
    if (type === 'today') {
      const due = buildQueue('due');
      const news = buildQueue('new');
      return due.concat(news);
    }
    if (type === 'favorites') return pool.filter(function (w) { return w.favorite; });
    if (type === 'difficult') return pool.filter(SRS.isDifficult);
    if (type.indexOf('category:') === 0) {
      const catId = type.slice('category:'.length);
      return pool.filter(function (w) { return w.category === catId; });
    }
    return pool;
  }

  function startStudy(type) {
    studyQueue = shuffleKeepOrder(buildQueue(type));
    studyIndex = 0;
    studyFlipped = false;
    if (!studyQueue.length) {
      showScreen('study');
      renderStudyCard();
      return;
    }
    showScreen('study');
    renderStudyCard();
  }
  function shuffleKeepOrder(arr) { return arr; } // due/new order is meaningful; kept as-is

  function currentStudyWord() { return studyQueue[studyIndex]; }

  function renderStudyCard() {
    const wrap = $('#study-card-wrap');
    const total = studyQueue.length;
    $('#study-progress-label').textContent = total ? (studyIndex + 1) + ' / ' + total : '0 / 0';
    $('#study-progress-bar').style.width = total ? Math.round((studyIndex / total) * 100) + '%' : '0%';

    if (!total || studyIndex >= total) {
      wrap.innerHTML = '<div class="empty-state"><span class="emoji">🎉</span>' +
        (total ? 'Xong! Bạn đã học hết danh sách này.' : 'Không có từ nào trong danh sách này.') +
        '</div><button class="big-cta" id="study-back-home">Về Trang chủ</button>';
      $('#study-back-home').onclick = function () { showScreen('home'); };
      return;
    }

    const w = currentStudyWord();
    const cat = categoryById(w.category);
    let html = '<div class="flashcard" id="flashcard">' +
      '<span class="cat-chip">' + cat.icon + ' ' + escapeHtml(cat.vi) + '</span>' +
      '<button class="fav-btn" id="fc-fav">' + (w.favorite ? '⭐' : '☆') + '</button>' +
      '<div class="hanzi">' + escapeHtml(w.chinese) + '</div>' +
      '<button class="speak-btn" id="fc-speak">🔊</button>';
    if (studyFlipped) {
      html += '<div class="pinyin">' + escapeHtml(w.pinyin) + '</div>' +
        '<div class="meaning">' + escapeHtml(w.vietnamese) + '</div>';
      if (w.example) {
        html += '<div class="example-block"><div class="example-zh">' + escapeHtml(w.example) + '</div>' +
          '<div>' + escapeHtml(w.exampleTranslation) + '</div></div>';
      }
    } else {
      html += '<div class="hint">Chạm vào thẻ để xem nghĩa</div>';
    }
    html += '</div>';
    wrap.innerHTML = html;

    $('#flashcard').addEventListener('click', function (e) {
      if (e.target.closest('#fc-fav') || e.target.closest('#fc-speak')) return;
      studyFlipped = !studyFlipped;
      renderStudyCard();
    });
    $('#fc-speak').onclick = function (e) { e.stopPropagation(); TTS.speak(w.chinese); };
    $('#fc-fav').onclick = function (e) { e.stopPropagation(); DB.toggleFavorite(w.id); studyQueue[studyIndex] = DB.byId(w.id); renderStudyCard(); };

    $('#grade-row').classList.toggle('hidden', !studyFlipped);
  }

  function gradeCurrent(gradeName) {
    const w = currentStudyWord();
    if (!w) return;
    const patch = SRS.grade(w, gradeName);
    DB.updateProgress(w.id, patch);
    DB.logStudyEvent(gradeName !== 'again');
    studyIndex++;
    studyFlipped = false;
    renderStudyCard();
  }

  // ---------------- Search ----------------
  function renderSearch(query) {
    const list = $('#search-results');
    const q = (query || '').trim().toLowerCase();
    if (!q) { list.innerHTML = '<div class="empty-state"><span class="emoji">🔍</span>Nhập từ khóa để tìm kiếm (Hán tự, pinyin, tiếng Việt...)</div>'; return; }
    const results = DB.all().filter(function (w) {
      return (w.chinese && w.chinese.toLowerCase().indexOf(q) !== -1) ||
        (w.pinyin && w.pinyin.toLowerCase().indexOf(q) !== -1) ||
        (w.vietnamese && w.vietnamese.toLowerCase().indexOf(q) !== -1) ||
        (w.english && w.english.toLowerCase().indexOf(q) !== -1) ||
        (categoryById(w.category).vi.toLowerCase().indexOf(q) !== -1);
    }).slice(0, 60);
    list.innerHTML = results.length ? results.map(wordRowHTML).join('') :
      '<div class="empty-state"><span class="emoji">🙁</span>Không tìm thấy kết quả.</div>';
    bindWordRows(list);
  }

  function wordRowHTML(w) {
    return '<div class="word-row" data-id="' + w.id + '">' +
      '<div class="wz">' + escapeHtml(w.chinese) + '</div>' +
      '<div class="wmeta"><div class="wpinyin">' + escapeHtml(w.pinyin) + '</div>' +
      '<div class="wvi">' + escapeHtml(w.vietnamese) + '</div></div>' +
      '<button class="wspeak" data-speak="' + w.id + '">🔊</button>' +
      '<button class="wfav" data-fav="' + w.id + '">' + (w.favorite ? '⭐' : '☆') + '</button>' +
      '</div>';
  }

  function bindWordRows(root) {
    $all('.word-row', root).forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.closest('[data-fav]') || e.target.closest('[data-speak]')) return;
        openWordDetail(row.dataset.id);
      });
    });
    $all('[data-speak]', root).forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); TTS.speak(DB.byId(b.dataset.speak).chinese); };
    });
    $all('[data-fav]', root).forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        DB.toggleFavorite(b.dataset.fav);
        b.textContent = DB.byId(b.dataset.fav).favorite ? '⭐' : '☆';
      };
    });
  }

  // ---------------- Word detail modal (view-only, no grading) ----------------
  function openWordDetail(id) {
    const w = DB.byId(id);
    if (!w) return;
    const cat = categoryById(w.category);
    const modal = el('div', 'card', '');
    modal.style.cssText = 'position:fixed;left:16px;right:16px;top:12%;z-index:200;max-width:528px;margin:0 auto;';
    modal.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
      '<span class="cat-chip" style="position:static;">' + cat.icon + ' ' + escapeHtml(cat.vi) + '</span>' +
      '<button id="wd-close" style="background:none;border:none;font-size:20px;">✕</button></div>' +
      '<div class="hanzi" style="font-size:40px;margin:10px 0 4px;">' + escapeHtml(w.chinese) +
      ' <button id="wd-speak" style="font-size:18px;border:none;background:var(--surface-2);border-radius:50%;width:36px;height:36px;">🔊</button></div>' +
      '<div class="pinyin">' + escapeHtml(w.pinyin) + '</div>' +
      '<div class="meaning">' + escapeHtml(w.vietnamese) + '</div>' +
      (w.english ? '<div style="color:var(--text-dim);font-size:13px;margin-top:2px;">EN: ' + escapeHtml(w.english) + '</div>' : '') +
      (w.example ? '<div class="example-block"><div class="example-zh">' + escapeHtml(w.example) + '</div><div>' + escapeHtml(w.exampleTranslation) + '</div></div>' : '') +
      '<div style="margin-top:12px;display:flex;gap:8px;">' +
      '<button id="wd-fav" class="pill-btn' + (w.favorite ? ' active' : '') + '">⭐ Yêu thích</button>' +
      '<button id="wd-study" class="pill-btn">📚 Ôn từ này</button></div>';
    const backdrop = el('div', '');
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:199;';
    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    function close() { backdrop.remove(); modal.remove(); }
    backdrop.onclick = close;
    $('#wd-close', modal).onclick = close;
    $('#wd-speak', modal).onclick = function () { TTS.speak(w.chinese); };
    $('#wd-fav', modal).onclick = function () { DB.toggleFavorite(w.id); close(); openWordDetail(id); };
    $('#wd-study', modal).onclick = function () {
      close();
      studyQueue = [DB.byId(w.id)];
      studyIndex = 0; studyFlipped = false;
      showScreen('study'); renderStudyCard();
    };
  }

  // ---------------- Categories ----------------
  function renderCategories() {
    const pool = DB.all();
    const counts = {};
    pool.forEach(function (w) { counts[w.category] = (counts[w.category] || 0) + 1; });
    const list = $('#categories-list');
    list.innerHTML = DB.getCategories().map(function (c) {
      return '<div class="cat-row" data-cat="' + c.id + '">' +
        '<span class="cicon">' + c.icon + '</span>' +
        '<span class="cname">' + escapeHtml(c.vi) + '</span>' +
        '<span class="ccount">' + (counts[c.id] || 0) + '</span></div>';
    }).join('');
    $all('.cat-row', list).forEach(function (row) {
      row.onclick = function () { openCategoryDetail(row.dataset.cat); };
    });
  }

  function openCategoryDetail(catId) {
    activeCategoryId = catId;
    const cat = categoryById(catId);
    $('#category-detail-title').textContent = cat.icon + ' ' + cat.vi;
    const words = DB.all().filter(function (w) { return w.category === catId; });
    $('#category-detail-count').textContent = words.length + ' từ';
    $('#category-detail-list').innerHTML = words.length ? words.map(wordRowHTML).join('') :
      '<div class="empty-state"><span class="emoji">📭</span>Chưa có từ nào trong danh mục này.</div>';
    bindWordRows($('#category-detail-list'));
    showScreen('category-detail');
  }

  // ---------------- Favorites / Difficult ----------------
  function renderFavorites() {
    const words = DB.all().filter(function (w) { return w.favorite; });
    $('#favorites-list').innerHTML = words.length ? words.map(wordRowHTML).join('') :
      '<div class="empty-state"><span class="emoji">⭐</span>Chưa có từ yêu thích nào. Chạm ☆ trên thẻ để đánh dấu.</div>';
    bindWordRows($('#favorites-list'));
  }

  function renderDifficult() {
    const words = DB.all().filter(SRS.isDifficult)
      .sort(function (a, b) { return (b.incorrectCount || 0) - (a.incorrectCount || 0); });
    $('#difficult-list').innerHTML = words.length ? words.map(function (w) {
      return wordRowHTML(w).replace('</div>\n', '</div>');
    }).join('') : '<div class="empty-state"><span class="emoji">💪</span>Chưa có từ khó nào — tiếp tục phát huy nhé!</div>';
    bindWordRows($('#difficult-list'));
  }

  // ---------------- Progress dashboard ----------------
  function renderProgress() {
    const pool = DB.all();
    const settings = DB.getSettings();
    const learned = pool.filter(function (w) { return w.reviewStatus !== 'new'; });
    const mastered = pool.filter(function (w) { return w.reviewStatus === 'mastered'; });
    const reviewStage = pool.filter(function (w) { return w.reviewStatus === 'review'; });
    const due = pool.filter(function (w) { return w.reviewStatus !== 'new' && SRS.isDue(w); });
    const difficult = pool.filter(SRS.isDifficult);
    const favorites = pool.filter(function (w) { return w.favorite; });
    const totalReviews = pool.reduce(function (s, w) { return s + (w.reviewCount || 0); }, 0);
    const totalCorrect = pool.reduce(function (s, w) { return s + (w.correctCount || 0); }, 0);
    const accuracy = totalReviews ? Math.round((totalCorrect / totalReviews) * 100) : 0;

    $('#progress-stats').innerHTML = [
      ['Tổng số từ', pool.length], ['Đã học', learned.length], ['Đang học', pool.length - learned.length],
      ['Đã thuộc', mastered.length], ['Cần ôn hôm nay', due.length], ['Từ khó', difficult.length],
      ['Yêu thích', favorites.length], ['Streak', (settings.streak || 0) + ' ngày'],
      ['Tổng ngày học', settings.totalStudyDays || 0], ['Độ chính xác', accuracy + '%'],
    ].map(function (pair) {
      return '<div class="stat-tile" style="flex:0 0 47%;margin-bottom:10px;"><div class="num">' + pair[1] + '</div><div class="label">' + pair[0] + '</div></div>';
    }).join('');

    $('#progress-chart').innerHTML = Charts.weeklyBarChartSVG(DB.last7DaysActivity());

    const catCounts = {};
    pool.forEach(function (w) { catCounts[w.category] = catCounts[w.category] || { total: 0, learned: 0 }; });
    pool.forEach(function (w) {
      catCounts[w.category].total++;
      if (w.reviewStatus !== 'new') catCounts[w.category].learned++;
    });
    $('#progress-categories').innerHTML = DB.getCategories()
      .filter(function (c) { return catCounts[c.id] && catCounts[c.id].total > 0; })
      .map(function (c) {
        const info = catCounts[c.id];
        const pct = info.total ? Math.round((info.learned / info.total) * 100) : 0;
        return '<div class="cat-progress-row"><div class="cpr-label"><span>' + c.icon + ' ' + escapeHtml(c.vi) +
          '</span><span class="n">' + info.learned + '/' + info.total + '</span></div>' +
          '<div class="progress-bar-outer"><div class="progress-bar-inner" style="width:' + pct + '%"></div></div></div>';
      }).join('');
  }

  // ---------------- Real Packaging Chinese (dialogues) ----------------
  function renderDialogues() {
    const wrap = $('#dialogues-list');
    wrap.innerHTML = dialogues.map(function (d) {
      const lines = d.lines.map(function (l, i) {
        return '<div class="dline"><span class="drole">' + escapeHtml(l.role) + '</span>' +
          '<button class="dspeak" data-speak-line="' + d.id + ':' + i + '">🔊</button>' +
          '<div class="dzh">' + escapeHtml(l.zh) + '</div><div class="dvi">' + escapeHtml(l.vi) + '</div></div>';
      }).join('');
      return '<div class="dialogue-card"><h3>' + escapeHtml(d.scenario) + '</h3>' +
        '<div class="droles">' + d.roles.map(escapeHtml).join(' ↔ ') + '</div>' + lines + '</div>';
    }).join('');
    $all('[data-speak-line]', wrap).forEach(function (b) {
      b.onclick = function () {
        const parts = b.dataset.speakLine.split(':');
        const d = dialogues.find(function (x) { return x.id === parts[0]; });
        TTS.speak(d.lines[parseInt(parts[1], 10)].zh);
      };
    });
  }

  // ---------------- Quiz ----------------
  function renderQuizMenu() {
    const grid = $('#quiz-mode-grid');
    grid.innerHTML = Object.keys(Quiz.MODES).map(function (id) {
      const m = Quiz.MODES[id];
      return '<button class="quiz-mode-card" data-mode="' + id + '"><span class="qicon">' + m.icon + '</span>' +
        '<div class="qname">' + escapeHtml(m.name) + '</div><div class="qdesc">' + escapeHtml(m.desc) + '</div></button>';
    }).join('');
    $all('[data-mode]', grid).forEach(function (b) { b.onclick = function () { startQuiz(b.dataset.mode); }; });
  }

  function startQuiz(modeId) {
    currentQuizMode = modeId;
    quizScore = { correct: 0, total: 0 };
    showScreen('quiz-play');
    nextQuizQuestion();
  }

  function nextQuizQuestion() {
    const pool = DB.all();
    currentQuestion = Quiz.nextQuestion(currentQuizMode, pool, dialogues);
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    $('#quiz-score').textContent = 'Điểm: ' + quizScore.correct + ' / ' + quizScore.total;
    const wrap = $('#quiz-question');
    if (!currentQuestion) {
      wrap.innerHTML = '<div class="empty-state"><span class="emoji">🙁</span>Chưa đủ dữ liệu cho chế độ này.</div>';
      return;
    }
    const q = currentQuestion;
    let mainDisplay = q.prompt;
    let speakBtn = '';
    if (q.mode === 'listening') {
      mainDisplay = '🔊';
      speakBtn = '<button id="quiz-speak" style="margin-top:8px;background:var(--surface-2);border:none;border-radius:20px;padding:8px 16px;">Nghe lại</button>';
    }
    wrap.innerHTML =
      '<div class="quiz-prompt"><div class="qp-main">' + escapeHtml(mainDisplay) + '</div>' +
      (q.sub ? '<div class="qp-sub">' + escapeHtml(q.sub) + '</div>' : '') + speakBtn + '</div>' +
      '<div class="quiz-options">' + q.options.map(function (o, i) {
        const letter = String.fromCharCode(65 + i);
        return '<button class="quiz-option" data-idx="' + i + '"><span class="qletter">' + letter + '.</span>' + escapeHtml(o.label) + '</button>';
      }).join('') + '</div>';

    if (q.mode === 'listening') {
      setTimeout(function () { TTS.speak(q.speak); }, 150);
      const sb = $('#quiz-speak'); if (sb) sb.onclick = function () { TTS.speak(q.speak); };
    }
    $all('.quiz-option', wrap).forEach(function (btn) {
      btn.onclick = function () { answerQuiz(parseInt(btn.dataset.idx, 10)); };
    });
  }

  function answerQuiz(idx) {
    const q = currentQuestion;
    const opts = $all('.quiz-option');
    const chosen = q.options[idx];
    quizScore.total++;
    if (chosen.correct) quizScore.correct++;
    opts.forEach(function (btn, i) {
      btn.onclick = null;
      if (q.options[i].correct) btn.classList.add('correct');
      else if (i === idx) btn.classList.add('incorrect');
    });
    if (q.target && q.target.id) {
      DB.updateProgress(q.target.id, SRS.grade(DB.byId(q.target.id) || q.target, chosen.correct ? 'good' : 'again'));
      DB.logStudyEvent(chosen.correct);
    }
    $('#quiz-score').textContent = 'Điểm: ' + quizScore.correct + ' / ' + quizScore.total;
    setTimeout(nextQuizQuestion, 1100);
  }

  // ---------------- More menu ----------------
  function renderMore() {
    const items = [
      { id: 'categories', icon: '🗂️', label: 'Danh mục từ vựng' },
      { id: 'favorites', icon: '⭐', label: 'Yêu thích' },
      { id: 'difficult', icon: '🧠', label: 'Từ hay quên' },
      { id: 'dialogues', icon: '💬', label: 'Tiếng Trung thực tế' },
      { id: 'progress', icon: '📊', label: 'Tiến độ học tập' },
      { id: 'settings', icon: '⚙️', label: 'Cài đặt · Sao lưu · AI' },
    ];
    $('#more-list').innerHTML = items.map(function (it) {
      return '<div class="cat-row" data-nav="' + it.id + '"><span class="cicon">' + it.icon + '</span>' +
        '<span class="cname">' + it.label + '</span><span class="ccount">›</span></div>';
    }).join('');
    $all('[data-nav]', $('#more-list')).forEach(function (row) {
      row.onclick = function () { showScreen(row.dataset.nav); };
    });
  }

  // ---------------- Settings: import / export / backup / AI ----------------
  let pendingImport = null;

  function renderSettings() {
    const s = DB.getSettings();
    $('#setting-daily-limit').value = s.dailyNewLimit || 30;
    $('#setting-api-key').value = s.apiKey || '';
    $('#setting-ai-model').value = s.aiModel || 'claude-haiku-4-5';
    $('#import-preview').innerHTML = '';
    $('#gap-analysis-result').innerHTML = '';
  }

  function handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let rows = [];
      try {
        if (/\.json$/i.test(file.name)) {
          const parsed = JSON.parse(reader.result);
          rows = Array.isArray(parsed) ? parsed : (parsed.words || parsed.customVocab || []);
        } else {
          rows = Importer.parseCSV(reader.result);
        }
      } catch (e) {
        toast('Không đọc được file: ' + e.message);
        return;
      }
      const prep = Importer.prepareImport(rows, DB.getCategories());
      pendingImport = prep;
      renderImportPreview(prep);
    };
    reader.readAsText(file, 'utf-8');
  }

  function renderImportPreview(prep) {
    const box = $('#import-preview');
    const summary = '<p>✅ Từ mới: ' + prep.toAdd.length + ' &nbsp; ⏭️ Trùng lặp: ' + prep.duplicates.length +
      ' &nbsp; ⚠️ Không hợp lệ: ' + prep.invalid.length + '</p>';
    const rows = prep.toAdd.slice(0, 12).map(function (w) {
      return '<div class="import-preview-row"><span>' + escapeHtml(w.chinese) + ' — ' + escapeHtml(w.vietnamese).slice(0, 30) +
        '</span><span class="ipr-status status-new">' + categoryById(w.category).vi + '</span></div>';
    }).join('');
    box.innerHTML = summary + rows +
      (prep.toAdd.length ? '<button class="big-cta" id="confirm-import" style="margin-top:10px;">Xác nhận nhập ' + prep.toAdd.length + ' từ</button>' : '');
    if (prep.toAdd.length) {
      $('#confirm-import').onclick = function () {
        const added = Importer.commitImport(pendingImport.toAdd);
        toast('Đã thêm ' + added + ' từ mới vào bộ từ vựng.');
        box.innerHTML = '';
        renderHome();
      };
    }
  }

  function downloadTextFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function exportBackupFile() {
    const data = DB.exportBackup();
    downloadTextFile('chinese-packaging-vocab-backup-' + DB.todayStr() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('Đã xuất file sao lưu JSON.');
  }
  function exportCSVFile() {
    downloadTextFile('chinese-packaging-vocab-' + DB.todayStr() + '.csv', DB.exportVocabCSV(), 'text/csv');
    toast('Đã xuất file CSV.');
  }
  function restoreBackupFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(reader.result);
        DB.importBackup(data, { merge: true });
        toast('Đã khôi phục dữ liệu từ file sao lưu.');
        renderHome();
      } catch (e) {
        toast('File sao lưu không hợp lệ: ' + e.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function runGapAnalysis() {
    const gaps = AI.analyzeGaps(DB.all(), DB.getCategories()).slice(0, 8);
    $('#gap-analysis-result').innerHTML = '<p style="font-size:13px;color:var(--text-dim);">Danh mục đang thiếu từ vựng nhất (ưu tiên cao trước):</p>' +
      gaps.map(function (g) { return '<span class="pill-btn active">' + escapeHtml(g.vi) + ' (' + g.count + ')</span>'; }).join('');
    return gaps;
  }

  async function generateAIWords() {
    const s = DB.getSettings();
    const apiKey = $('#setting-api-key').value.trim();
    const model = $('#setting-ai-model').value;
    DB.updateSettings({ apiKey: apiKey, aiModel: model });
    if (!apiKey) { toast('Vui lòng nhập Anthropic API key trước.'); return; }
    const gaps = runGapAnalysis();
    const btn = $('#btn-generate-ai');
    btn.disabled = true; btn.textContent = 'Đang tạo từ vựng...';
    try {
      const words = await AI.generateVocabulary({
        apiKey: apiKey, model: model, count: 30,
        focusCategories: gaps.slice(0, 5),
        existingChineseWords: DB.all().map(function (w) { return w.chinese; }),
        categoryIds: DB.getCategories().map(function (c) { return c.id; }),
      });
      const prep = Importer.prepareImport(words, DB.getCategories());
      pendingImport = prep;
      renderImportPreview(prep);
      toast('AI đã tạo ' + words.length + ' từ, xem trước bên dưới.');
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false; btn.textContent = '🤖 Tạo 30 từ mới bằng AI';
    }
  }

  // ---------------- Wiring ----------------
  function wireEvents() {
    $all('.tab-btn').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.tab === 'study') { startStudy('today'); return; }
        showScreen(b.dataset.tab);
      };
    });
    $all('[data-nav]').forEach(function (b) { if (!b._wired) { b._wired = true; b.onclick = function () { showScreen(b.dataset.nav); }; } });

    $('#home-start-today').onclick = function () { startStudy('today'); };
    $('#home-quick-review').onclick = function () { startStudy('due'); };
    $('#home-quick-new').onclick = function () { startStudy('new'); };
    $('#home-quick-quiz').onclick = function () { showScreen('quiz-menu'); };
    $('#home-quick-search').onclick = function () { showScreen('search'); };
    $('#home-quick-favorites').onclick = function () { showScreen('favorites'); };
    $('#home-quick-progress').onclick = function () { showScreen('progress'); };

    $('#study-back').onclick = function () { showScreen('home'); };
    $('#grade-again').onclick = function () { gradeCurrent('again'); };
    $('#grade-hard').onclick = function () { gradeCurrent('hard'); };
    $('#grade-good').onclick = function () { gradeCurrent('good'); };
    $('#grade-easy').onclick = function () { gradeCurrent('easy'); };

    $('#search-input').addEventListener('input', function (e) {
      clearTimeout(searchDebounce);
      const val = e.target.value;
      searchDebounce = setTimeout(function () { renderSearch(val); }, 120);
    });

    $('#category-detail-back').onclick = function () { showScreen('categories'); };
    $('#category-detail-study').onclick = function () { if (activeCategoryId) startStudy('category:' + activeCategoryId); };

    $('#quiz-menu-back').onclick = function () { showScreen('more'); };
    $('#quiz-play-back').onclick = function () { showScreen('quiz-menu'); };

    $('#import-file').addEventListener('change', function (e) {
      if (e.target.files[0]) handleImportFile(e.target.files[0]);
    });
    $('#restore-file').addEventListener('change', function (e) {
      if (e.target.files[0]) restoreBackupFile(e.target.files[0]);
    });
    $('#btn-export-backup').onclick = exportBackupFile;
    $('#btn-export-csv').onclick = exportCSVFile;
    $('#btn-run-gap-analysis').onclick = runGapAnalysis;
    $('#btn-generate-ai').onclick = generateAIWords;
    $('#setting-daily-limit').addEventListener('change', function (e) {
      DB.updateSettings({ dailyNewLimit: parseInt(e.target.value, 10) || 30 });
      toast('Đã lưu cài đặt.');
    });
    $('#setting-api-key').addEventListener('change', function (e) {
      DB.updateSettings({ apiKey: e.target.value.trim() });
    });
    $('#setting-ai-model').addEventListener('change', function (e) {
      DB.updateSettings({ aiModel: e.target.value });
    });
  }

  async function init() {
    await DB.init();
    dialogues = await fetch('data/dialogues.json').then(function (r) { return r.json(); }).catch(function () { return []; });
    wireEvents();
    showScreen('home');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW register failed', e); });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
