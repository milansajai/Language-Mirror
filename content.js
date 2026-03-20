(() => {
  let isEnabled = true, intensity = 10, currentLang = 'es', difficulty = 'beginner';
  let ignoredWords = [], readingMode = false, highlightColor = '#ffffff';
  let processedNodes = new WeakSet(), observer = null, activeDict = {};
  let seenWords = {}, sessionStart = Date.now();

  const SKIP_TAGS = new Set(['SCRIPT','STYLE','TEXTAREA','CODE','PRE','INPUT','SELECT','BUTTON','NOSCRIPT','IFRAME','SVG','MATH','HEAD']);

  // ── Boot ──────────────────────────────────────────────────────────────────
  chrome.storage.local.get([
    'lm_enabled','lm_intensity','lm_language','lm_difficulty',
    'lm_ignored','lm_reading_mode','lm_highlight_color',
    'lm_site_overrides','lm_seen_words','lm_vault'
  ], (r) => {
    isEnabled      = r.lm_enabled      !== undefined ? r.lm_enabled : true;
    intensity      = r.lm_intensity    !== undefined ? r.lm_intensity : 10;
    currentLang    = r.lm_language     || 'es';
    difficulty     = r.lm_difficulty   || 'beginner';
    ignoredWords   = r.lm_ignored      || [];
    readingMode    = r.lm_reading_mode || false;
    highlightColor = r.lm_highlight_color || '#ffffff';
    seenWords      = r.lm_seen_words   || {};

    const host = location.hostname;
    const overrides = r.lm_site_overrides || {};
    if (overrides[host] !== undefined) isEnabled = overrides[host];

    buildDict();
    if (isEnabled) initMirror();
  });

  // ── Messages ──────────────────────────────────────────────────────────────
  try { chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'LM_UPDATE') {
      // Capture PREVIOUS values before updating so comparisons are correct
      const prevLang      = currentLang;
      const prevIntensity = intensity;
      const prevEnabled   = isEnabled;
      const prevReading   = readingMode;
      const prevColor     = highlightColor;

      isEnabled      = msg.enabled;
      intensity      = msg.intensity;
      currentLang    = msg.language      || currentLang;
      difficulty     = msg.difficulty    || difficulty;
      readingMode    = msg.readingMode   !== undefined ? msg.readingMode : readingMode;
      highlightColor = msg.highlightColor|| highlightColor;
      ignoredWords   = msg.ignoredWords  || ignoredWords;

      const colorChanged    = highlightColor !== prevColor;
      const readingChanged  = readingMode !== prevReading;
      const anythingElse    = isEnabled !== prevEnabled || intensity !== prevIntensity || currentLang !== prevLang;

      // Only color changed — recolor spans in place, no DOM re-scan
      if (colorChanged && !anythingElse && !readingChanged) {
        recolorAll(highlightColor);
        return;
      }

      // Only reading mode changed — update span text in place, no DOM re-scan
      if (readingChanged && !colorChanged && !anythingElse) {
        updateReadingMode();
        return;
      }

      // Anything else (language, intensity, enabled) — full re-process
      buildDict();
      revertAll();
      if (observer) observer.disconnect();
      if (isEnabled) initMirror();
    }
    if (msg.type === 'LM_IGNORE_WORD') {
      ignoredWords.push(msg.word);
      revertAll();
      if (isEnabled) initMirror();
    }
  }); } catch(e) {}

  // ── Build dict ────────────────────────────────────────────────────────────
  function buildDict() {
    const langData = (typeof LANGUAGES !== 'undefined') ? LANGUAGES[currentLang] : null;
    if (!langData) { activeDict = {}; return; }
    const raw = langData.dict;
    // For difficulty filtering, use the DIFFICULTIES word list as a guide,
    // but always fall back to ALL dict words so replacements actually show up
    activeDict = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!ignoredWords.includes(k)) activeDict[k] = v;
    }
  }

  function initMirror() {
    if (!Object.keys(activeDict).length) return;
    processBody(document.body);
    startObserver();
    trackSession();
  }

  // ── Process DOM ───────────────────────────────────────────────────────────
  function processBody(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('.lm-word,#lm-tooltip,[id^="lm-"]')) return NodeFilter.FILTER_REJECT;
        if (processedNodes.has(node)) return NodeFilter.FILTER_REJECT;
        if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    const BATCH = 60;
    function runBatch(i) {
      if (!isEnabled) return;
      for (let j = i; j < Math.min(i + BATCH, nodes.length); j++)
        if (nodes[j].parentNode) replaceInNode(nodes[j]);
      if (i + BATCH < nodes.length)
        (window.requestIdleCallback || (cb => setTimeout(cb, 16)))(() => runBatch(i + BATCH));
    }
    runBatch(0);
  }

  // ── Replace in text node ──────────────────────────────────────────────────
  // Uses per-word probability so intensity % is respected uniformly across
  // the whole page, not forced to minimum 1 per node.
  function replaceInNode(textNode) {
    processedNodes.add(textNode);
    const text = textNode.textContent;
    const matches = [...text.matchAll(/\b([a-zA-Z]{3,})\b/g)];
    const replaceable = matches.filter(m => activeDict[m[1].toLowerCase()]);
    if (!replaceable.length) return;

    const pct = Math.min(Math.max(intensity, 1), 100) / 100;

    // Build set of positions to replace using per-word probability roll
    const chosenPositions = new Set();
    for (const m of replaceable) {
      if (Math.random() < pct) chosenPositions.add(m.index);
    }

    // If nothing was chosen by chance (can happen on short nodes at low intensity),
    // skip this node entirely — do NOT force a replacement
    if (!chosenPositions.size) return;

    const frag = document.createDocumentFragment();
    let last = 0;

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const lower = m[1].toLowerCase();
      const start = m.index;
      const end = start + m[1].length;

      if (last < start) frag.appendChild(document.createTextNode(text.slice(last, start)));

      if (chosenPositions.has(start) && activeDict[lower]) {
        frag.appendChild(buildSpan(m[1], activeDict[lower]));
      } else {
        frag.appendChild(document.createTextNode(m[1]));
      }
      last = end;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  }

  // ── Apply highlight color inline on a span ───────────────────────────────
  function applyColor(span, color) {
    let r = 255, g = 255, b = 255;
    if (color && color.startsWith('#') && color.length === 7) {
      r = parseInt(color.slice(1, 3), 16);
      g = parseInt(color.slice(3, 5), 16);
      b = parseInt(color.slice(5, 7), 16);
    }
    span.style.setProperty('background-color', `rgba(${r},${g},${b},0.15)`, 'important');
    span.style.setProperty('border-bottom',    `1.5px dashed rgba(${r},${g},${b},0.6)`, 'important');
    span.style.setProperty('border-radius',    '3px', 'important');
    span.style.setProperty('padding',          '0 2px', 'important');
    span.style.setProperty('cursor',           'default', 'important');
    span.style.setProperty('display',          'inline', 'important');
    span.dataset.color = color;
  }

  // ── Build span ────────────────────────────────────────────────────────────
  function buildSpan(original, translated) {
    const span = document.createElement('span');
    span.className = 'lm-word';
    // Reading mode: show "translated (original)" so learner sees both
    span.textContent = readingMode ? `${translated} (${original})` : translated;
    span.dataset.original = original;
    span.dataset.translated = translated;
    applyColor(span, highlightColor);

    span.addEventListener('mouseenter', () => {
      trackVocab(original.toLowerCase(), translated);
      showTooltip(span, original, translated);
    });

    // FIX: use a small delay before hiding so clicking the tooltip button works
    span.addEventListener('mouseleave', (e) => {
      // Don't hide if mouse is moving into the tooltip
      const tip = getTooltip();
      const related = e.relatedTarget;
      if (tip && (tip === related || tip.contains(related))) return;
      scheduleHide();
    });

    return span;
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────
  let tooltipEl = null;
  let hideTimer = null;

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (tooltipEl) tooltipEl.style.display = 'none';
    }, 120);
  }

  function cancelHide() {
    clearTimeout(hideTimer);
  }

  function getTooltip() {
    if (tooltipEl) return tooltipEl;

    tooltipEl = document.createElement('div');
    tooltipEl.id = 'lm-tooltip';

    // Keep tooltip visible when mouse enters it
    tooltipEl.addEventListener('mouseenter', cancelHide);
    tooltipEl.addEventListener('mouseleave', scheduleHide);

    const shadow = tooltipEl.attachShadow({ mode: 'open' }); // 'open' so button events fire reliably
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; font-family: system-ui, sans-serif; }
      .box {
        background: #111;
        color: #fff;
        border: 1px solid #2a2a2a;
        border-radius: 9px;
        padding: 7px 11px;
        display: flex;
        align-items: center;
        gap: 10px;
        white-space: nowrap;
        box-shadow: 0 6px 24px rgba(0,0,0,.7);
        animation: pop .12s cubic-bezier(.34,1.56,.64,1);
      }
      @keyframes pop {
        from { opacity:0; transform: scale(.85) translateY(4px); }
        to   { opacity:1; transform: none; }
      }
      .tr { font-size: 14px; font-weight: 700; color: #fff; }
      .or { font-size: 11px; color: #666; }
      .btn {
        background: none;
        border: 1px solid #333;
        border-radius: 50%;
        width: 26px;
        height: 26px;
        cursor: pointer;
        color: #aaa;
        font-size: 13px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background .15s, border-color .15s;
        padding: 0;
      }
      .btn:hover { background: #1e1e1e; border-color: #555; }
      .btn:active { background: #2a2a2a; }
    `;

    const box = document.createElement('div');
    box.className = 'box';
    shadow.appendChild(style);
    shadow.appendChild(box);
    tooltipEl._shadow = shadow;
    tooltipEl._box = box;

    document.body.appendChild(tooltipEl);
    Object.assign(tooltipEl.style, {
      position: 'absolute',
      zIndex: '2147483647',
      pointerEvents: 'auto',
      display: 'none'
    });
    return tooltipEl;
  }

  function showTooltip(span, original, translated) {
    cancelHide();
    const tip = getTooltip();
    const box = tip._box;
    box.innerHTML = '';

    const t = document.createElement('span');
    t.className = 'tr';
    t.textContent = translated;

    const o = document.createElement('span');
    o.className = 'or';
    o.textContent = `← ${original}`;

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = '🔊';
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent focus blur which can trigger hide
      e.stopPropagation();
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      speak(translated);
    });

    box.appendChild(t);
    box.appendChild(o);
    box.appendChild(btn);

    tip.style.display = 'block';

    const rect = span.getBoundingClientRect();
    const tipW = 200; // estimated
    let left = rect.left + window.scrollX;
    // keep within viewport
    if (left + tipW > window.innerWidth) left = window.innerWidth - tipW - 10 + window.scrollX;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top  = `${rect.bottom + window.scrollY + 6}px`;
  }

  function hideTooltipNow() {
    clearTimeout(hideTimer);
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  // ── Speech ────────────────────────────────────────────────────────────────
  function speak(word) {
    if (!window.speechSynthesis) return;
    const utt = new SpeechSynthesisUtterance(word);
    utt.lang = LANGUAGES?.[currentLang]?.voice || 'en-US';
    utt.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);
  }

  // ── Track vocab — only count NEW words ───────────────────────────────────
  function trackVocab(word, translated) {
    const isNew = !seenWords[word];

    chrome.storage.local.get(['lm_vault', 'lm_stats', 'lm_daily_progress', 'lm_goal', 'lm_seen_words'], (r) => {
      const vault  = r.lm_vault            || {};
      const stats  = r.lm_stats            || {};
      const today  = new Date().toDateString();
      const daily  = r.lm_daily_progress   || { date: null, count: 0 };
      const seen   = r.lm_seen_words       || {};

      if (!vault[word]) vault[word] = { count: 0, translated, lang: currentLang };
      vault[word].count++;

      if (isNew && !seen[word]) {
        seen[word] = true;
        seenWords[word] = true;

        if (daily.date !== today) { daily.date = today; daily.count = 0; }
        daily.count++;

        stats.wordsLearned = (stats.wordsLearned || 0) + 1;
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        if (stats.lastActive === yesterday) stats.dayStreak = (stats.dayStreak || 0) + 1;
        else if (stats.lastActive !== today) stats.dayStreak = 1;
        stats.lastActive = today;
      }

      try {
        chrome.storage.local.set({ lm_vault: vault, lm_stats: stats, lm_daily_progress: daily, lm_seen_words: seen });
      } catch(e) {}
    });
  }

  // ── Session tracking ──────────────────────────────────────────────────────
  function trackSession() {
    window.addEventListener('beforeunload', () => {
      try {
        const mins = (Date.now() - sessionStart) / 60000;
        chrome.storage.local.get('lm_stats', (r) => {
          if (chrome.runtime.lastError) return;
          const s = r.lm_stats || {};
          s.hoursImmersed = (s.hoursImmersed || 0) + mins / 60;
          s.totalSessions = (s.totalSessions || 0) + 1;
          chrome.storage.local.set({ lm_stats: s });
        });
      } catch(e) { /* extension context invalidated — ignore */ }
    });
  }

  // ── Revert ────────────────────────────────────────────────────────────────
  function revertAll() {
    document.querySelectorAll('.lm-word').forEach(s => {
      s.parentNode?.replaceChild(document.createTextNode(s.dataset.original), s);
    });
    hideTooltipNow();
    processedNodes = new WeakSet();
  }

  // ── Recolor all existing spans without re-processing DOM ─────────────────
  function recolorAll(color) {
    document.querySelectorAll('.lm-word').forEach(s => applyColor(s, color));
  }

  // ── Update span text when reading mode toggles ────────────────────────────
  function updateReadingMode() {
    document.querySelectorAll('.lm-word').forEach(s => {
      const orig = s.dataset.original;
      const trans = s.dataset.translated;
      if (!orig || !trans) return;
      s.textContent = readingMode ? `${trans} (${orig})` : trans;
    });
  }

  // ── Observer ──────────────────────────────────────────────────────────────
  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(muts => {
      if (!isEnabled) return;
      for (const m of muts)
        for (const node of m.addedNodes)
          if (node.nodeType === Node.ELEMENT_NODE && !node.classList?.contains('lm-word'))
            (window.requestIdleCallback || (cb => setTimeout(cb, 16)))(() => processBody(node));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
})();
