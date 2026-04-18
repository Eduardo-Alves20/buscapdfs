try { require('dotenv').config(); } catch (_) {}
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { listArchivePdfFiles } = require('../lib/archive');
const {
  ensureSchema,
  getDocumentHashByPath,
  upsertDocument,
  closePool,
} = require('../lib/db');

const EXTRACTION_VERSION = 1;
const DEFAULT_CONCURRENCY = Number(process.env.INDEX_CONCURRENCY || 2);

function parseArgs(argv) {
  const args = { concurrency: DEFAULT_CONCURRENCY };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--from' && argv[i + 1]) args.from = argv[++i];
    if (token === '--to' && argv[i + 1]) args.to = argv[++i];
    if (token === '--concurrency' && argv[i + 1]) args.concurrency = Number(argv[++i]) || DEFAULT_CONCURRENCY;
  }
  return args;
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function extractPdfText(buffer) {
  const parsed = await pdfParse(buffer, { max: 0 });
  return normalizeText(parsed.text);
}

async function indexOne(item) {
  const buffer = fs.readFileSync(item.absolutePath);
  const hash = hashBuffer(buffer);
  const existingHash = await getDocumentHashByPath(item.relativePath);
  if (existingHash && existingHash === hash) return { status: 'skipped' };

  const text = await extractPdfText(buffer);
  await upsertDocument({
    relativePath: item.relativePath,
    absolutePath: path.resolve(item.absolutePath),
    filename: item.filename,
    sectionId: item.sectionId,
    sectionLabel: item.sectionLabel,
    editionDate: item.editionDate,
    fileHash: hash,
    fileSize: buffer.length,
    textContent: text,
    extractionVersion: EXTRACTION_VERSION,
  });

  return { status: existingHash ? 'updated' : 'inserted' };
}

async function runQueue(items, concurrency) {
  let cursor = 0;
  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  async function worker() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      const item = items[current];
      try {
        const result = await indexOne(item);
        if (result.status === 'inserted') inserted += 1;
        if (result.status === 'updated') updated += 1;
        if (result.status === 'skipped') skipped += 1;
      } catch (error) {
        failed += 1;
        console.error(`Erro ao indexar ${item.relativePath}: ${error.message}`);
      } finally {
        processed += 1;
        if (processed % 100 === 0 || processed === items.length) {
          console.log(
            `[${processed}/${items.length}] inseridos=${inserted} atualizados=${updated} ignorados=${skipped} falhas=${failed}`,
          );
        }
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return { processed, inserted, updated, skipped, failed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureSchema();

  const files = listArchivePdfFiles({
    dataInicio: args.from || null,
    dataFim: args.to || null,
    sections: [],
  });

  if (!files.length) {
    console.log('Nenhum PDF encontrado no acervo para indexar.');
    return;
  }

  console.log(`Indexacao iniciada para ${files.length} PDF(s) com concorrencia=${args.concurrency}.`);
  const startedAt = Date.now();
  const summary = await runQueue(files, args.concurrency);
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

  console.log('Indexacao concluida.');
  console.log(
    `Tempo: ${elapsedSeconds}s | processados=${summary.processed} inseridos=${summary.inserted} atualizados=${summary.updated} ignorados=${summary.skipped} falhas=${summary.failed}`,
  );
}

main()
  .catch(error => {
    console.error('Falha na indexacao:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
