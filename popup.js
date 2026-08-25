// popup.js – smart popup: scraper on draft pages, manual JSON otherwise (per-league)

function getSportAndLeagueId(url) {
  let sport = null;
  let leagueId = null;

  const baseballMatch = url.match(/baseball\.fantasysports\.yahoo\.com\/b1\/(\d+)/);
  const footballMatch = url.match(/football\.fantasysports\.yahoo\.com\/f1\/(\d+)/);

  if (baseballMatch) {
    sport = 'mlb';
    leagueId = baseballMatch[1];
  } else if (footballMatch) {
    sport = 'nfl';
    leagueId = footballMatch[1];
  }

  return { sport, leagueId };
}

(async function initPopup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  const { sport, leagueId } = getSportAndLeagueId(url);
  const storageKey = sport && leagueId
    ? `draftRounds_${sport}_${leagueId}`
    : null;

  const isDraftPage = url.includes('/draftresults') || url.includes('#drafttables');
  const isBaseball = url.includes('baseball.fantasysports.yahoo.com');
  const isFootball = url.includes('football.fantasysports.yahoo.com');

  const scraperSection = document.getElementById('scraperSection');
  const manualSection = document.getElementById('manualSection');
  const title = document.getElementById('title');
  const statsLine = document.getElementById('statsLine');

  // Show/hide sections based on page type
  if (isDraftPage && storageKey) {
    title.textContent =
      isBaseball
        ? `Baseball Draft Round Scraper (League ${leagueId})`
        : isFootball
          ? `Football Draft Round Scraper (League ${leagueId})`
          : `Draft Round Scraper (League ${leagueId})`;

    scraperSection.style.display = 'block';
    manualSection.style.display = 'none';

    document.getElementById('scrapeBtn').addEventListener('click', async () => {
      const status = document.getElementById('scrapeStatus');
      status.textContent = '';

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrapeDraftDataInPage
        });

        const draftMap = results[0]?.result;

        if (!draftMap || typeof draftMap !== 'object' || Object.keys(draftMap).length === 0) {
          status.textContent = 'No draft data found. Make sure you’re on the draft results page with #drafttables.';
          return;
        }

        await chrome.storage.local.set({ [storageKey]: draftMap });
        status.textContent = 'Saved ' + Object.keys(draftMap).length + ' players (' + storageKey + ').';
        updateStats(); // refresh count
      } catch (err) {
        console.error(err);
        status.textContent = 'Error scraping: ' + err.message;
      }
    });
  } else {
    title.textContent =
      isBaseball
        ? `Baseball Draft Round Helper (League ${leagueId || '?'})`
        : isFootball
          ? `Football Draft Round Helper (League ${leagueId || '?'})`
          : 'Draft Round Helper';

    scraperSection.style.display = 'none';
    manualSection.style.display = 'block';

    document.getElementById('saveBtn').addEventListener('click', async () => {
      const raw = document.getElementById('jsonInput').value.trim();
      const status = document.getElementById('status');
      status.textContent = '';

      if (!raw) {
        status.textContent = 'Please paste JSON first.';
        return;
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        status.textContent = 'Invalid JSON: ' + e.message;
        return;
      }

      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        status.textContent = 'JSON must be an object like {"12345": 3, "67890": 7}';
        return;
      }

      // Normalize keys to strings, values to numbers
      const normalized = {};
      for (const [k, v] of Object.entries(data)) {
        const num = Number(v);
        if (!Number.isFinite(num)) continue;
        normalized[String(k)] = Math.round(num);
      }

      const keyToUse = storageKey || 'draftRounds_mlb_unknown';
      await chrome.storage.local.set({ [keyToUse]: normalized });
      status.textContent = 'Saved ' + Object.keys(normalized).length + ' players (' + keyToUse + ').';
      updateStats(); // refresh count
    });

    // Delete button
    document.getElementById('deleteBtn').addEventListener('click', async () => {
      const deleteStatus = document.getElementById('deleteStatus');
      deleteStatus.textContent = '';

      const keyToUse = storageKey || 'draftRounds_mlb_unknown';

      const ok = confirm('This will remove all stored draft round data for this league (' + keyToUse + '). The Salary column will no longer show draft rounds until you scrape or import again. Continue?');
      if (!ok) return;

      await chrome.storage.local.remove([keyToUse]);
      deleteStatus.textContent = 'Draft data deleted (' + keyToUse + ').';
      updateStats(); // refresh count
    });
  }

  // Show current stored count for this league
  async function updateStats() {
    const keyToUse = storageKey || 'draftRounds_mlb_unknown';
    const stored = await chrome.storage.local.get([keyToUse]);
    const roundMap = stored[keyToUse] || {};
    const count = Object.keys(roundMap).length;
    if (count === 0) {
      statsLine.textContent = 'Stored: 0 players (no draft data for this league).';
    } else {
      statsLine.textContent = 'Stored: ' + count + ' players (' + keyToUse + ').';
    }
  }

  updateStats();
})();

// This function runs IN the page context (not the extension context)
function scrapeDraftDataInPage() {
  const map = {};
  const tables = document.querySelectorAll('#drafttables table.Table-interactive');

  tables.forEach((table) => {
    const headerTh = table.querySelector('thead th.Fw-b');
    if (!headerTh) return;

    const headerText = headerTh.textContent.trim();
    const roundMatch = headerText.match(/Round\s*(\d+)/i);
    if (!roundMatch) return;
    const round = parseInt(roundMatch[1], 10);

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach((row) => {
      // Support both MLB and NFL player URLs
      const link = row.querySelector('td.player a[href*="/mlb/players/"], td.player a[href*="/nfl/players/"]');
      if (!link) return;

      const m = link.href.match(/\/players\/(\d+)/);
      if (!m) return;

      const playerId = m[1];
      map[playerId] = round;
    });
  });

  return map;
}