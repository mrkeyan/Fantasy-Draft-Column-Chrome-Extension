// popup.js
// Scrapes Yahoo Fantasy Draft Results and saves draft-round mappings
// per sport and league ID.

function getSportAndLeagueId(url) {
  const baseballMatch = url.match(
    /baseball\.fantasysports\.yahoo\.com\/b1\/(\d+)/
  );

  const footballMatch = url.match(
    /football\.fantasysports\.yahoo\.com\/f1\/(\d+)/
  );

  if (baseballMatch) {
    return {
      sport: 'mlb',
      leagueId: baseballMatch[1]
    };
  }

  if (footballMatch) {
    return {
      sport: 'nfl',
      leagueId: footballMatch[1]
    };
  }

  return {
    sport: null,
    leagueId: null
  };
}

function getStorageKey(sport, leagueId) {
  if (!sport || !leagueId) {
    return null;
  }

  return `draftRounds_${sport}_${leagueId}`;
}

function getSportLabel(sport) {
  if (sport === 'mlb') {
    return 'Baseball';
  }

  if (sport === 'nfl') {
    return 'Football';
  }

  return 'Yahoo Fantasy';
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab || null;
}

async function getStoredMappingCount(storageKey) {
  if (!storageKey) {
    return 0;
  }

  const stored = await chrome.storage.local.get(storageKey);
  const roundMap = stored[storageKey] || {};

  return Object.keys(roundMap).length;
}

(async function initPopup() {
  const tab = await getActiveTab();
  const url = tab?.url || '';

  const { sport, leagueId } = getSportAndLeagueId(url);
  const storageKey = getStorageKey(sport, leagueId);

  const isDraftPage = /\/draftresults(?:[/?#]|$)/i.test(url);
  const sportLabel = getSportLabel(sport);

  const scraperSection = document.getElementById('scraperSection');
  const manualSection = document.getElementById('manualSection');
  const title = document.getElementById('title');
  const statsLine = document.getElementById('statsLine');

  async function updateStats() {
    if (!statsLine) {
      return;
    }

    if (!storageKey) {
      statsLine.textContent =
        'Stored: unavailable (open a supported Yahoo league page).';
      return;
    }

    const count = await getStoredMappingCount(storageKey);

    statsLine.textContent =
      count === 0
        ? `Stored: 0 mappings for League ${leagueId}.`
        : `Stored: ${count} mappings for League ${leagueId}.`;
  }

  if (isDraftPage && storageKey && tab?.id) {
    title.textContent = `${sportLabel} Draft Round Scraper (League ${leagueId})`;

    scraperSection.style.display = 'block';
    manualSection.style.display = 'none';

    const scrapeButton = document.getElementById('scrapeBtn');
    const scrapeStatus = document.getElementById('scrapeStatus');

    scrapeButton.addEventListener('click', async () => {
      scrapeButton.disabled = true;
      scrapeStatus.textContent = 'Scraping Yahoo Draft Results…';

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrapeDraftDataInPage
        });

        const scrapeResult = results[0]?.result || {};
        const draftMap = scrapeResult.map || {};
        const diagnostics = scrapeResult.diagnostics || {};
        const savedCount = Object.keys(draftMap).length;

        if (savedCount === 0) {
          scrapeStatus.textContent =
            `No draft data found. ` +
            `Tables: ${diagnostics.tablesFound || 0}; ` +
            `rounds: ${diagnostics.roundsFound || 0}; ` +
            `rows: ${diagnostics.rowsFound || 0}.`;

          console.warn(
            '[DRAFT ROUND] No mappings found during draft scrape:',
            diagnostics
          );

          return;
        }

        await chrome.storage.local.set({
          [storageKey]: draftMap
        });

        scrapeStatus.textContent =
          `Saved ${savedCount} mappings: ` +
          `${diagnostics.playerMappings || 0} players, ` +
          `${diagnostics.defenseMappings || 0} D/ST.`;

        console.log(
          '[DRAFT ROUND] Saved draft data:',
          {
            storageKey,
            savedCount,
            diagnostics
          }
        );

        await updateStats();
      } catch (error) {
        console.error('[DRAFT ROUND] Scrape error:', error);

        scrapeStatus.textContent =
          `Error scraping draft data: ${error.message}`;
      } finally {
        scrapeButton.disabled = false;
      }
    });
  } else {
    title.textContent = storageKey
      ? `${sportLabel} Draft Round Helper (League ${leagueId})`
      : 'Draft Round Helper';

    scraperSection.style.display = 'none';
    manualSection.style.display = 'block';

    const saveButton = document.getElementById('saveBtn');
    const jsonInput = document.getElementById('jsonInput');
    const status = document.getElementById('status');
    const deleteButton = document.getElementById('deleteBtn');
    const deleteStatus = document.getElementById('deleteStatus');

    saveButton.addEventListener('click', async () => {
      status.textContent = '';

      if (!storageKey) {
        status.textContent =
          'Open a supported Yahoo Baseball or Football league page first.';
        return;
      }

      const raw = jsonInput.value.trim();

      if (!raw) {
        status.textContent = 'Paste draft-round JSON first.';
        return;
      }

      let data;

      try {
        data = JSON.parse(raw);
      } catch (error) {
        status.textContent = `Invalid JSON: ${error.message}`;
        return;
      }

      if (
        typeof data !== 'object' ||
        data === null ||
        Array.isArray(data)
      ) {
        status.textContent =
          'JSON must be an object, for example: {\"12345\": 3}.';
        return;
      }

      const normalized = {};

      for (const [key, value] of Object.entries(data)) {
        const round = Number(value);

        if (Number.isFinite(round)) {
          normalized[String(key)] = Math.round(round);
        }
      }

      await chrome.storage.local.set({
        [storageKey]: normalized
      });

      status.textContent =
        `Saved ${Object.keys(normalized).length} mappings.`;

      await updateStats();
    });

    deleteButton.addEventListener('click', async () => {
      deleteStatus.textContent = '';

      if (!storageKey) {
        deleteStatus.textContent =
          'Open a supported Yahoo Baseball or Football league page first.';
        return;
      }

      const confirmed = confirm(
        `Delete all saved draft-round data for ${sportLabel} ` +
        `League ${leagueId}?`
      );

      if (!confirmed) {
        return;
      }

      await chrome.storage.local.remove(storageKey);

      deleteStatus.textContent =
        `Deleted saved data for League ${leagueId}.`;

      await updateStats();
    });
  }

  await updateStats();
})();

// This function is injected into the active Yahoo Draft Results page.
function scrapeDraftDataInPage() {
  const map = {};

  const diagnostics = {
    tablesFound: 0,
    roundsFound: 0,
    rowsFound: 0,
    playerMappings: 0,
    defenseMappings: 0,
    duplicateMappings: 0,
    unmatchedRows: []
  };

  // Yahoo Baseball and Football currently place all round tables in
  // #drafttables. Do not rely on cosmetic table classes.
  const tables = Array.from(
    document.querySelectorAll('#drafttables table')
  );

  diagnostics.tablesFound = tables.length;

  for (const table of tables) {
    const headerCells = Array.from(
      table.querySelectorAll('thead th')
    );

    const roundHeader = headerCells.find((headerCell) =>
      /round\s*\d+/i.test(headerCell.textContent)
    );

    const roundMatch = roundHeader?.textContent.match(
      /round\s*(\d+)/i
    );

    if (!roundMatch) {
      continue;
    }

    const round = Number.parseInt(roundMatch[1], 10);

    if (!Number.isFinite(round)) {
      continue;
    }

    diagnostics.roundsFound++;

    const rows = Array.from(
      table.querySelectorAll('tbody tr')
    );

    diagnostics.rowsFound += rows.length;

    for (const row of rows) {
      const link = row.querySelector('td.player a, a');

      if (!link) {
        diagnostics.unmatchedRows.push({
          round,
          reason: 'No player/team link found'
        });
        continue;
      }

      const href = link.href || '';
      const name = link.textContent.trim();

      // Standard Baseball and Football players, including kickers:
      // https://sports.yahoo.com/mlb/players/11771
      // https://sports.yahoo.com/nfl/players/40041
      const playerMatch = href.match(
        /\/(?:mlb|nfl)\/players\/(\d+)/i
      );

      if (playerMatch) {
        const playerId = playerMatch[1];

        if (Object.hasOwn(map, playerId)) {
          diagnostics.duplicateMappings++;
        }

        map[playerId] = round;
        diagnostics.playerMappings++;
        continue;
      }

      // Football D/ST:
      // https://sports.yahoo.com/nfl/teams/la-rams/
      // https://sports.yahoo.com/nfl/teams/denver/
      const defenseMatch = href.match(
        /\/nfl\/teams\/([^/?#]+)/i
      );

      if (defenseMatch) {
        const teamKey =
          `team:${defenseMatch[1].toLowerCase()}`;

        if (Object.hasOwn(map, teamKey)) {
          diagnostics.duplicateMappings++;
        }

        map[teamKey] = round;
        diagnostics.defenseMappings++;
        continue;
      }

      diagnostics.unmatchedRows.push({
        round,
        name,
        href,
        reason: 'Unsupported Yahoo player/team URL'
      });
    }
  }

  return {
    map,
    diagnostics
  };
}