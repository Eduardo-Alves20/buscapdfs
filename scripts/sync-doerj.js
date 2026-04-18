try { require('dotenv').config(); } catch (_) {}
const { syncArchiveByDate, syncArchiveToday } = require('../lib/archiveSync');

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find(value => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : '';
}

async function main() {
  const date = getArg('date');
  const force = process.argv.includes('--force');

  const result = date
    ? await syncArchiveByDate(date, { force })
    : await syncArchiveToday({ force });

  console.log(`[archive] Sync concluido (${result.dateKey})`);
  console.log(
    `[archive] status=${result.status} partsFound=${result.partsFound} partsProcessed=${result.partsProcessed} partsSkipped=${result.partsSkipped}`,
  );
}

main().catch(error => {
  console.error('[archive] Falha no sync:', error.message);
  process.exitCode = 1;
});
