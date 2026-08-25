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

  // Preferred: Salary is normally the numeric cell after the fantasy/roster
  // columns and immediately before the first statistics cell.
  //
  // Yahoo marks Salary with Bdrend, but several cells can have Bdrend.
  // Fall back to the calculated visual index.
  if (cells[salaryColumn]) {
    return cells[salaryColumn];
  }

  return null;
}

function isPlayerRow(row) {
  return Boolean(
    row.querySelector(
      '[data-ys-playerid], ' +
      'a[href*="/mlb/players/"], ' +
      'a[href*="/nfl/players/"]'
    )
  );
}

function getPlayerRows(table) {
  return Array.from(table.querySelectorAll('tbody tr')).filter(isPlayerRow);
}

function getRosterTables() {
  // Normal Baseball and Football roster pages:
  // statTable0, statTable1, statTable2, etc.
  const statTables = Array.from(
    document.querySelectorAll('table[id*="statTable"]')
  );

  // Football Set Keeper pages:
  // Table IDs are dynamic YUI IDs, so select only interactive tables
  // inside the keeper form that have a Salary header.
  const keeperTables = Array.from(
    document.querySelectorAll(
      '#choose-keepers-form table.Table-interactive'
    )
  ).filter((table) => findSalaryColumn(table) !== -1);

  return [...new Set([...statTables, ...keeperTables])];
}

function extractPlayerId(row) {
  // Yahoo uses this attribute on player links on common roster layouts.
  const playerElement = row.querySelector('[data-ys-playerid]');

  if (playerElement) {
    const playerId = playerElement.getAttribute('data-ys-playerid');

    if (playerId) {
      return playerId;
    }
  }

  // Fallback for the public player profile links in MLB and NFL.
  const playerLink = row.querySelector(
    'a[href*="/mlb/players/"], ' +
    'a[href*="/nfl/players/"]'
  );

  if (!playerLink) {
    return null;
  }

  const match = playerLink.href.match(/\/players\/(\d+)/);
  return match ? match[1] : null;
}

function setSalaryCellToDraftRound(cell, round) {
  const target = cell.querySelector('div') || cell;
  const text = round === undefined ? '—' : String(round);

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
    'players from',
    storageKey
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
      const playerId = extractPlayerId(row);

      if (!playerId) {
        continue;
      }

      const salaryCell = findSalaryCell(row, salaryColumn);

      if (!salaryCell) {
        console.warn(
          '[DRAFT ROUND] Salary cell missing:',
          tableId,
          '| Player ID:',
          playerId,
          '| Expected index:',
          salaryColumn,
          '| Actual cell count:',
          cells.length
        );
        continue;
      }

      setSalaryCellToDraftRound(salaryCell, roundMap[playerId]);
    }
  }

  console.log('[DRAFT ROUND] Salary replacement complete.');
}

function waitForYahooTables(timeoutMs = 10000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let completed = false;

    const finish = () => {
      if (completed) {
        return;
      }

      completed = true;
      observer.disconnect();
      resolve();
    };

    const check = () => {
      const tables = getRosterTables();

      if (tables.length > 0) {
        finish();
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
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
    console.error('[DRAFT ROUND] Failed to update Salary column:', error);
  }
})();