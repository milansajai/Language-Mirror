/* Language Mirror v3 — Popup Logic (Free + Donate) */

const CHAI_URL = 'https://www.chai4.me/languagemirror';

let state = {
  enabled:true, intensity:10, language:'es', difficulty:'beginner',
  vault:{}, stats:{}, ignored:[], siteOverrides:{},
  goal:5, highlightColor:'#ffffff', readingMode:false,
  dailyProgress:{date:null,count:0}
};
let qCorrect=0, qWrong=0, currentQuiz=null;

// ── Boot ──────────────────────────────────────────────────────────────────
chrome.storage.local.get([
  'lm_enabled','lm_intensity','lm_language','lm_difficulty',
  'lm_vault','lm_stats','lm_ignored','lm_site_overrides',
  'lm_goal','lm_highlight_color','lm_reading_mode','lm_daily_progress'
], (r) => {
  state.enabled        = r.lm_enabled        !== undefined ? r.lm_enabled        : true;
  state.intensity      = r.lm_intensity      !== undefined ? r.lm_intensity      : 10;
  state.language       = r.lm_language       || 'es';
  state.difficulty     = r.lm_difficulty     || 'beginner';
  state.vault          = r.lm_vault          || {};
  state.stats          = r.lm_stats          || {};
  state.ignored        = r.lm_ignored        || [];
  state.siteOverrides  = r.lm_site_overrides || {};
  state.goal           = r.lm_goal           || 5;
  state.highlightColor = r.lm_highlight_color|| '#ffffff';
  state.readingMode    = r.lm_reading_mode   || false;
  state.dailyProgress  = r.lm_daily_progress || {date:null,count:0};
  renderAll();
});

function renderAll() {
  renderHeader();
  renderHome();
  renderLangs();
  renderStats();
}

// ── Header ────────────────────────────────────────────────────────────────
function renderHeader() {
  const dot = $('dot-el');
  dot.classList.toggle('on', state.enabled);
  const streak = state.stats.dayStreak || 0;
  const el = $('streak-el');
  el.textContent = `🔥 ${streak}`;
  el.classList.toggle('active', streak > 0);
}

// ── HOME ──────────────────────────────────────────────────────────────────
function renderHome() {
  $('tog-global').checked   = state.enabled;
  $('int-slider').value     = state.intensity;
  $('int-disp').textContent = `${state.intensity}%`;
  $('tog-reading').checked  = state.readingMode;

  // Site toggle
  chrome.tabs.query({active:true,currentWindow:true}, tabs => {
    if (!tabs[0]) return;
    try {
      const host = new URL(tabs[0].url).hostname;
      $('cur-host').textContent = host;
      const on = state.siteOverrides[host] !== undefined ? state.siteOverrides[host] : state.enabled;
      $('tog-site').checked = on;
    } catch(e) {
      $('cur-host').textContent = 'Not a webpage';
      $('tog-site').disabled = true;
    }
  });

  // Goal bar
  const today = new Date().toDateString();
  const p = state.dailyProgress;
  const count = p.date === today ? p.count : 0;
  const pct = Math.min(100, Math.round((count / state.goal) * 100));
  $('goal-cur').textContent = count;
  $('goal-tgt').textContent = state.goal;
  $('goal-fill').style.width = `${pct}%`;

  // Difficulty pills
  document.querySelectorAll('.pill[data-diff]').forEach(p =>
    p.classList.toggle('active', p.dataset.diff === state.difficulty));
}

// ── LANGUAGES ─────────────────────────────────────────────────────────────
function renderLangs() {

  const grid = $('all-langs');
  grid.innerHTML = '';
  Object.entries(LANGUAGES).forEach(([code, lang]) => {
    const c = document.createElement('div');
    c.className = `lc${code === state.language ? ' active' : ''}`;
    c.innerHTML = `<span class="flag">${lang.flag}</span><span class="lname">${lang.name}</span>`;
    c.onclick = () => selectLang(code);
    grid.appendChild(c);
  });
}

function selectLang(code) {
  state.language = code;
  chrome.storage.local.set({lm_language: code});
  broadcast(); renderLangs();
}

// ── QUIZ ──────────────────────────────────────────────────────────────────
function renderQuiz() {
  const area     = $('quiz-area');
  const scoreRow = $('quiz-score-row');
  scoreRow.style.display = 'flex';

  const entries = Object.entries(state.vault);
  if (entries.length < 2) {
    area.innerHTML = '<div class="quiz-empty">Hover over at least 2 replaced words on any page to unlock the quiz!</div>';
    return;
  }
  if (!currentQuiz) nextQuiz(entries);
}

function nextQuiz(entries) {
  if (!entries) entries = Object.entries(state.vault);
  if (entries.length < 2) return;

  const [word, data] = entries[Math.floor(Math.random() * entries.length)];
  const correct = data.translated;
  const lang = LANGUAGES[data.lang || state.language];
  const others = Object.values(lang?.dict || {}).filter(v => v !== correct);
  const opts = shuffle([correct, ...shuffle(others).slice(0, 3)]);
  currentQuiz = {word, correct};

  const area = $('quiz-area');
  area.innerHTML = `
    <div class="quiz-card">
      <div class="quiz-q">What is the ${lang?.name || 'translation'} for…</div>
      <div class="quiz-word">${word}</div>
      <div class="quiz-lang">${lang?.flag || ''} ${lang?.name || ''}</div>
    </div>
    <div class="quiz-opts" id="qopts"></div>`;

  opts.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'qopt'; btn.textContent = opt;
    btn.onclick = () => answerQuiz(opt, entries);
    $('qopts').appendChild(btn);
  });
}

function answerQuiz(chosen, entries) {
  document.querySelectorAll('.qopt').forEach(b => {
    b.style.pointerEvents = 'none';
    if (b.textContent === currentQuiz.correct) b.classList.add('correct');
    if (b.textContent === chosen && chosen !== currentQuiz.correct) b.classList.add('wrong');
  });
  if (chosen === currentQuiz.correct) { qCorrect++; $('qc').textContent = qCorrect; }
  else { qWrong++; $('qw').textContent = qWrong; }
  currentQuiz = null;
  setTimeout(() => nextQuiz(entries), 900);
}

// ── STATS ─────────────────────────────────────────────────────────────────
function renderStats() {
  const s = state.stats;
  $('st-words').textContent  = s.wordsLearned  || 0;
  $('st-streak').textContent = s.dayStreak      || 0;
  $('st-hours').textContent  = `${((s.hoursImmersed || 0)).toFixed(1)}h`;
  $('st-sess').textContent   = s.totalSessions  || 0;
  $('goal-slider').value     = state.goal;
  $('goal-disp').textContent = state.goal;

  // Vocab Vault — open for everyone
  const vaultArea = $('vault-area');
  const entries = Object.entries(state.vault).sort((a,b) => b[1].count - a[1].count).slice(0, 25);
  if (!entries.length) {
    vaultArea.innerHTML = '<div class="vault-empty">Hover replaced words to fill your vault</div>';
  } else {
    vaultArea.innerHTML = '<div class="vault-list" id="vlist"></div>';
    entries.forEach(([word, data]) => {
      const item = document.createElement('div'); item.className = 'vi';
      const learning = data.count >= 3;
      item.innerHTML = `<div><span class="vi-en">${word}</span><span class="vi-tr">→ ${data.translated}</span></div><span class="vi-badge${learning ? ' learning' : ''}">${learning ? '★ ' : ''}${data.count}</span>`;
      $('vlist').appendChild(item);
    });
  }

  // Swatches
  document.querySelectorAll('.swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.color === state.highlightColor));

  renderIgnored();
}

function renderIgnored() {
  const el = $('ignored-area');
  if (!state.ignored.length) {
    el.innerHTML = '<span class="no-ig">No ignored words yet. Right-click any word on a page.</span>';
    return;
  }
  el.innerHTML = '<div class="ignored-wrap" id="ig-list"></div>';
  state.ignored.forEach(word => {
    const chip = document.createElement('div'); chip.className = 'ig-chip';
    chip.innerHTML = `<span>${word}</span><button data-w="${word}">✕</button>`;
    chip.querySelector('button').onclick = () => removeIgnored(word);
    $('ig-list').appendChild(chip);
  });
}

function removeIgnored(word) {
  state.ignored = state.ignored.filter(w => w !== word);
  chrome.storage.local.set({lm_ignored: state.ignored});
  broadcast(); renderIgnored();
}

// ── Events ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  document.querySelectorAll('.nb').forEach(btn => btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  }));

  $('tog-global').onchange = () => {
    state.enabled = $('tog-global').checked;
    chrome.storage.local.set({lm_enabled: state.enabled});
    renderHeader(); broadcast();
  };

  $('tog-site').onchange = () => {
    chrome.tabs.query({active:true,currentWindow:true}, tabs => {
      if (!tabs[0]) return;
      try {
        const host = new URL(tabs[0].url).hostname;
        state.siteOverrides[host] = $('tog-site').checked;
        chrome.storage.local.set({lm_site_overrides: state.siteOverrides});

        broadcast();
      } catch(e) {}
    });
  };

  $('int-slider').oninput = () => {
    state.intensity = parseInt($('int-slider').value);
    $('int-disp').textContent = `${state.intensity}%`;
    chrome.storage.local.set({lm_intensity: state.intensity});
    broadcast();
  };

  $('tog-reading').onchange = () => {
    state.readingMode = $('tog-reading').checked;
    chrome.storage.local.set({lm_reading_mode: state.readingMode});
    broadcast();
  };

  $('goal-slider').oninput = () => {
    state.goal = parseInt($('goal-slider').value);
    $('goal-disp').textContent = state.goal;
    chrome.storage.local.set({lm_goal: state.goal});
    renderHome();
  };

  document.querySelectorAll('.swatch').forEach(sw => sw.onclick = () => {
    state.highlightColor = sw.dataset.color;
    chrome.storage.local.set({lm_highlight_color: state.highlightColor});
    document.querySelectorAll('.swatch').forEach(s =>
      s.classList.toggle('active', s.dataset.color === state.highlightColor));
    broadcast();
  });

  $('donate-btn').onclick = () => chrome.tabs.create({url: CHAI_URL});

  $('clr-vault').onclick = () => {
    if (!confirm('Clear Vocab Vault?')) return;
    state.vault = {}; chrome.storage.local.set({lm_vault: {}}); renderStats();
  };
  $('clr-ignored').onclick = () => {
    state.ignored = []; chrome.storage.local.set({lm_ignored: []}); broadcast(); renderIgnored();
  };
  $('rst-stats').onclick = () => {
    if (!confirm('Reset all stats?')) return;
    state.stats = {}; chrome.storage.local.set({lm_stats: {}}); renderStats(); renderHeader();
  };
});

// ── Switch tab ────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.nb').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'quiz')  renderQuiz();
  if (tab === 'stats') renderStats();
  if (tab === 'lang')  renderLangs();
}

// ── Broadcast ─────────────────────────────────────────────────────────────
function broadcast() {
  chrome.tabs.query({active:true,currentWindow:true}, tabs => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'LM_UPDATE', enabled: state.enabled, intensity: state.intensity,
      language: state.language, difficulty: state.difficulty,
      readingMode: state.readingMode, highlightColor: state.highlightColor,
      ignoredWords: state.ignored
    }).catch(() => {});
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
