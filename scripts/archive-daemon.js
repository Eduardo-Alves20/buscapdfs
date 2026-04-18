try { require('dotenv').config(); } catch (_) {}
const cron = require('node-cron');
const { syncArchiveToday, syncArchiveByDate, getBrazilDateKey, addDays } = require('../lib/archiveSync');

const ARCHIVE_ENABLED = process.env.ARCHIVE_SYNC_ENABLED !== 'false';
const ARCHIVE_CRON = process.env.ARCHIVE_SYNC_CRON || '0 10 * * 1-5';
const ARCHIVE_CRON_SECOND = process.env.ARCHIVE_SYNC_CRON_SECOND || '0 20 * * 1-5';
const ARCHIVE_SECOND_FORCE_REFRESH = process.env.ARCHIVE_SYNC_CRON_SECOND_FORCE !== 'false';
const ARCHIVE_RETRY_PREVIOUS_DAY = process.env.ARCHIVE_SYNC_RETRY_PREVIOUS_DAY !== 'false';
const RUN_ON_STARTUP = process.env.ARCHIVE_SYNC_RUN_ON_STARTUP === 'true';
const TIMEZONE = process.env.CRON_TIMEZONE || 'America/Sao_Paulo';

let running = false;

async function guardedSync(label, fn) {
  if (running) {
    console.log(`[archive][${label}] Execucao ignorada (sync anterior ainda em andamento).`);
    return;
  }

  running = true;
  try {
    await fn();
  } catch (error) {
    console.error(`[archive][${label}] Erro:`, error.message);
  } finally {
    running = false;
  }
}

async function runMainWindow() {
  const result = await syncArchiveToday({ force: false });
  console.log(
    `[archive][cron-main] date=${result.dateKey} status=${result.status} partsFound=${result.partsFound} partsProcessed=${result.partsProcessed} partsSkipped=${result.partsSkipped}`,
  );
}

async function runSecondWindow() {
  const todayResult = await syncArchiveToday({ force: ARCHIVE_SECOND_FORCE_REFRESH });
  console.log(
    `[archive][cron-second] date=${todayResult.dateKey} status=${todayResult.status} partsFound=${todayResult.partsFound} partsProcessed=${todayResult.partsProcessed} partsSkipped=${todayResult.partsSkipped}`,
  );

  if (!ARCHIVE_RETRY_PREVIOUS_DAY) return;
  const todayKey = getBrazilDateKey();
  const yesterday = addDays(todayKey, -1);
  if (!yesterday) return;

  const previousResult = await syncArchiveByDate(yesterday, { force: false });
  console.log(
    `[archive][cron-second] retryYesterday=${yesterday} status=${previousResult.status} partsFound=${previousResult.partsFound} partsProcessed=${previousResult.partsProcessed} partsSkipped=${previousResult.partsSkipped}`,
  );
}

function start() {
  if (!ARCHIVE_ENABLED) {
    console.log('[archive] Daemon desativado via ARCHIVE_SYNC_ENABLED=false');
    return;
  }

  cron.schedule(ARCHIVE_CRON, () => {
    guardedSync('cron-main', runMainWindow);
  }, { timezone: TIMEZONE });
  console.log(`[archive] Agendado janela 1: "${ARCHIVE_CRON}" [tz=${TIMEZONE}]`);

  if (ARCHIVE_CRON_SECOND && ARCHIVE_CRON_SECOND !== ARCHIVE_CRON) {
    cron.schedule(ARCHIVE_CRON_SECOND, () => {
      guardedSync('cron-second', runSecondWindow);
    }, { timezone: TIMEZONE });
    console.log(
      `[archive] Agendado janela 2: "${ARCHIVE_CRON_SECOND}" [tz=${TIMEZONE}] forceRefresh=${ARCHIVE_SECOND_FORCE_REFRESH} retryYesterday=${ARCHIVE_RETRY_PREVIOUS_DAY}`,
    );
  } else {
    console.log('[archive] Janela 2 desativada (expressao vazia ou igual a janela 1).');
  }

  if (RUN_ON_STARTUP) {
    guardedSync('startup', runMainWindow);
  }
}

start();
