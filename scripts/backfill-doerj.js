try { require('dotenv').config(); } catch (_) {}
const { syncArchiveRange } = require('../lib/archiveSync');

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find(value => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : '';
}

function printUsageAndExit() {
  console.error('Uso: node scripts/backfill-doerj.js --start=YYYY-MM-DD --end=YYYY-MM-DD [--force]');
  process.exit(1);
}

async function main() {
  const startDate = getArg('start');
  const endDate = getArg('end');
  const force = process.argv.includes('--force');
  if (!startDate || !endDate) {
    printUsageAndExit();
  }

  const result = await syncArchiveRange({
    startDate,
    endDate,
    force,
  });

  console.log(`[archive] Backfill concluido: ${startDate} -> ${endDate}`);
  console.log(
    `[archive] dias=${result.totalDays} partes_processadas=${result.totalProcessedParts} partes_puladas=${result.totalSkippedParts} erros=${result.totalErrors}`,
  );
}

main().catch(error => {
  console.error('[archive] Falha no backfill:', error.message);
  process.exitCode = 1;
});
