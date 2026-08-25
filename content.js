// content.js
// Replaces Yahoo's Salary column values with each player's draft round.

console.log('[DRAFT ROUND] content.js loaded');

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

function getStorageKey() {
  const { sport, leagueId } = getSportAndLeagueId(location.href);

  if (!sport || !leagueId) {
    return null;
  }

  return `draftRounds_${sport}_${leagueId}`;
}

function normaliseText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findSalaryColumn(table) {
  const headerRows = Array.from(table.querySelectorAll('thead tr'));
  const detailHeaderRow = headerRows[headerRows.length - 1];

  if (!detailHeaderRow) {
    return -1;
  }

  let bodyCellIndex = 0;

  for (const headerCell of detailHeaderRow.querySelectorAll('th')) {
    const headerText = normaliseText(headerCell.textContent);

    if (headerText.startsWith('salary')) {
      return bodyCellIndex;
    }

    const colspan = Number.parseInt(
      headerCell.getAttribute('colspan') || '1',
      10
    );

    bodyCellIndex += colspan;
  }

  return -1;
}

function findSalaryCell(row, salaryColumn) {
  const cells = Array.from(row.querySelectorAll(':scope > td'));
  return cells[salaryColumn] || null;
}

function isPlayerRow(row) {
  return Boolean(
    row.querySelector(
      '[data-ys-playerid], ' +
      'a[href*="/mlb/players/"], ' +
      'a[href*="/nfl/players/"], ' +
      'a[href*="/nfl/teams/"]'
    )
  );
}

function getPlayerRows(table) {
  return Array.from(table.querySelectorAll('tbody tr')).filter(isPlayerRow);
}

function getRosterTables() {
  // Team/roster pages: statTable0, statTable1, statTable2, etc.
  const statTables = Array.from(
    document.querySelectorAll('table[id*="statTable"]')
  );

  // Football Set Keeper pages: dynamic Yahoo/YUI table IDs.
  const keeperTables = Array.from(
    document.querySelectorAll(
      '#choose-keepers-form table.Table-interactive'
    )
  ).filter((table) => findSalaryColumn(table) !== -1);

  return [...new Set([...statTables, ...keeperTables])];
}

function extractPlayerId(row) {
  const playerElement = row.querySelector('[data-ys-playerid]');

  // Normal roster pages normally expose a stable Yahoo Fantasy ID.
  let playerId = playerElement?.getAttribute('data-ys-playerid') || null;

  const playerLink = row.querySelector(
    'a[href*="/mlb/players/"], ' +
    'a[href*="/nfl/players/"], ' +
    'a[href*="/nfl/teams/"]'
  );

  // Fallback for normal player links where data-ys-playerid is absent.
  if (!playerId && playerLink) {
    const playerMatch = playerLink.href.match(/\/players\/(\d+)/);

    if (playerMatch) {
      playerId = playerMatch[1];
    }
  }

  // Team D/ST does not have a /players/{id} draft-results URL.
  // The stable shared identifier across draft and roster pages is its team slug.
  const teamMatch = playerLink?.href.match(/\/nfl\/teams\/([^/?#]+)/);

  const teamKey = teamMatch
    ? `team:${teamMatch[1].toLowerCase()}`
    : null;

  return {
    playerId,
    teamKey
  };
}

function setSalaryCellToDraftRound(cell, round) {
  const target = cell.querySelector('div') || cell;
    const text =
    round === null || round === undefined
      ? '—'
      : String(round);

  target.textContent = text;

  cell.title =
    round === undefined
      ? 'Draft round unavailable'
      : `Draft round: ${round}`;

  cell.classList.add('draft-round-replaced');
}

async function fillSalaryWithDraftRound() {
  const storageKey = getStorageKey();

  if (!storageKey) {
    console.warn(
      '[DRAFT ROUND] Could not identify sport and league ID from this URL.'
    );
    return;
  }

  const stored = await chrome.storage.local.get(storageKey);
  const roundMap = stored[storageKey] || {};
  const savedPlayerCount = Object.keys(roundMap).length;

  console.log(
    '[DRAFT ROUND] Loaded',
    savedPlayerCount,
    'draft mappings from',
    storageKey
  );

  console.log(
    '[DRAFT ROUND] D/ST debug:',
    'numeric Rams ID (100014):',
    roundMap['100014'],
    '| Rams team key:',
    roundMap['team:la-rams']
  );

  if (savedPlayerCount === 0) {
    console.warn(
      '[DRAFT ROUND] No saved draft data exists for this league.'
    );
    return;
  }

  const tables = getRosterTables();

  console.log(
    '[DRAFT ROUND] Found candidate roster/keeper tables:',
    tables.length
  );

  for (const table of tables) {
    const tableId = table.id || '(keeper table with dynamic ID)';
    const salaryColumn = findSalaryColumn(table);

    if (salaryColumn === -1) {
      console.log(
        '[DRAFT ROUND] Skipping table without a Salary column:',
        tableId
      );
      continue;
    }

    const playerRows = getPlayerRows(table);

    console.log(
      '[DRAFT ROUND] Processing',
      tableId,
      '| Salary column:',
      salaryColumn,
      '| Player rows:',
      playerRows.length
    );

    for (const row of playerRows) {
      const playerRef = extractPlayerId(row);

      if (!playerRef || (!playerRef.playerId && !playerRef.teamKey)) {
        continue;
      }

      const { playerId, teamKey } = playerRef;

      // Prefer a numeric Yahoo player ID. For D/ST, fall back to team:slug.
      const draftRound =
        (playerId && roundMap[playerId]) ??
        (teamKey && roundMap[teamKey]);

      const salaryCell = findSalaryCell(row, salaryColumn);

      if (!salaryCell) {
        console.warn(
          '[DRAFT ROUND] Salary cell missing:',
          tableId,
          '| Player:',
          playerId || teamKey,
          '| Expected cell index:',
          salaryColumn,
          '| Actual cell count:',
          row.querySelectorAll(':scope > td').length
        );
        continue;
      }

      setSalaryCellToDraftRound(salaryCell, draftRound);
    }
  }

  console.log('[DRAFT ROUND] Salary replacement complete.');
}

function waitForYahooTables(timeoutMs = 10000) {
  return new Promise((resolve) => {
    let finished = false;

    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;
      observer.disconnect();
      resolve();
    };

    const check = () => {
      if (getRosterTables().length > 0) {
        finish();
      }
    };

    const observer = new MutationObserver(check);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    check();
    setTimeout(finish, timeoutMs);
  });
}

(async function initialiseDraftRounds() {
  try {
    await waitForYahooTables();
    await fillSalaryWithDraftRound();
  } catch (error) {
    console.error(
      '[DRAFT ROUND] Failed to update Salary column:',
      error
    );
  }
})();