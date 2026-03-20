// Language Mirror v3 — Background Service Worker

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({
      lm_enabled: true,
      lm_intensity: 10,
      lm_language: 'es',
      lm_difficulty: 'beginner',
      lm_vault: {},
      lm_stats: { wordsLearned: 0, dayStreak: 0, lastActive: null, hoursImmersed: 0, totalSessions: 0 },
      lm_ignored: [],
      lm_site_overrides: {},
      lm_premium: false,
      lm_goal: 5,
      lm_highlight_color: '#ffffff',
      lm_reading_mode: false,
      lm_daily_progress: { date: null, count: 0 },
      lm_seen_words: {}
    });
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'lm-ignore-word',
      title: 'Language Mirror: Ignore this word',
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'lm-ignore-word' && info.selectionText) {
    const word = info.selectionText.trim().toLowerCase();
    chrome.storage.local.get('lm_ignored', (result) => {
      const ignored = result.lm_ignored || [];
      if (!ignored.includes(word)) {
        ignored.push(word);
        chrome.storage.local.set({ lm_ignored: ignored });
        chrome.tabs.sendMessage(tab.id, { type: 'LM_IGNORE_WORD', word });
      }
    });
  }
});

chrome.alarms.create('lm-daily-check', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'lm-daily-check') {
    chrome.storage.local.get(['lm_stats'], (result) => {
      const stats = result.lm_stats || {};
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      if (stats.lastActive !== today && stats.lastActive !== yesterday) {
        stats.dayStreak = 0;
        chrome.storage.local.set({ lm_stats: stats });
      }
    });
  }
});
