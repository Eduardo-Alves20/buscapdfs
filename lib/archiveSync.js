const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { chromium } = require('playwright');

const DOERJ_BASE_URL = 'https://www.ioerj.com.br/portal/modules/conteudoonline';
const DEFAULT_ARCHIVE_DIR = path.join(__dirname, '..', 'doerj');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatDateKey(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getBrazilDateKey(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  if (!year || !month || !day) return null;

  return formatDateKey(year, month, day);
}

function addDays(dateKey, days) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  const value = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  value.setUTCDate(value.getUTCDate() + Number(days || 0));
  return formatDateKey(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function buildSelectionUrl(dateKey) {
  const encodedDate = Buffer.from(String(dateKey || '').replace(/-/g, ''), 'utf8').toString('base64');
  return `${DOERJ_BASE_URL}/do_seleciona_edicao.php?data=${encodedDate}`;
}

function buildArchivePathInfo(dateKey, partSlug, archiveRootDir = DEFAULT_ARCHIVE_DIR) {
  const parts = parseDateKey(dateKey);
  if (!parts) {
    throw new Error(`Data invalida: "${dateKey}"`);
  }

  const yyyy = String(parts.year).padStart(4, '0');
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  const dayDir = path.join(archiveRootDir, yyyy, mm, dd);
  const fileName = `${dd}-${partSlug}.pdf`;
  const absolutePath = path.join(dayDir, fileName);

  return {
    dayDir,
    fileName,
    absolutePath,
    relativePath: path.relative(path.join(__dirname, '..'), absolutePath).replace(/\\/g, '/'),
  };
}

async function downloadPdfToFile(pdfUrl, absolutePath) {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const response = await axios.get(pdfUrl, {
    responseType: 'stream',
    timeout: 120000,
  });

  const tmpPath = `${absolutePath}.tmp`;
  try {
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tmpPath);
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });

    fs.renameSync(tmpPath, absolutePath);
  } catch (error) {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    throw error;
  }

  return fs.statSync(absolutePath).size;
}

async function listPartLinks(page, selectionUrl) {
  const links = await page.locator('a[href*="mostra_edicao.php"]').evaluateAll(nodes => {
    return nodes.map(node => ({
      label: (node.textContent || '').trim(),
      href: node.getAttribute('href') || '',
    }));
  });

  const dedup = new Map();
  for (const link of links) {
    const label = String(link.label || '').trim();
    if (!label) continue;
    const href = new URL(link.href, selectionUrl).toString();
    const key = `${normalizeText(label)}|${href}`;
    if (!dedup.has(key)) {
      dedup.set(key, { label, href });
    }
  }

  return [...dedup.values()];
}

async function extractPdfUrl(browser, partLink) {
  const viewerPage = await browser.newPage();
  try {
    await viewerPage.goto(partLink.href, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await viewerPage.waitForFunction(() => {
      return Boolean(window.PDFViewerApplication && window.PDFViewerApplication.pdfDocument);
    }, null, { timeout: 60000 });

    const pdfUrl = await viewerPage.evaluate(() => window.PDFViewerApplication?.url || '');
    if (!pdfUrl) {
      throw new Error(`Nao foi possivel obter PDF URL para "${partLink.label}"`);
    }
    return pdfUrl;
  } finally {
    await viewerPage.close();
  }
}

async function syncArchiveByDate(dateKey, options = {}) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) throw new Error(`Data invalida para sync: "${dateKey}"`);

  const archiveRootDir = options.archiveRootDir || process.env.DOERJ_ARCHIVE_DIR || DEFAULT_ARCHIVE_DIR;
  const force = options.force === true;
  const selectionUrl = buildSelectionUrl(dateKey);
  const browser = await chromium.launch({ headless: true });

  try {
    const selectionPage = await browser.newPage();
    await selectionPage.goto(selectionUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    const partLinks = await listPartLinks(selectionPage, selectionUrl);
    await selectionPage.close();

    if (!partLinks.length) {
      return {
        dateKey,
        status: 'no-edition',
        partsFound: 0,
        partsProcessed: 0,
        partsSkipped: 0,
        downloadedFiles: [],
      };
    }

    const downloadedFiles = [];
    let partsProcessed = 0;
    let partsSkipped = 0;

    for (const partLink of partLinks) {
      const partSlug = slugifyLabel(partLink.label) || 'parte';
      const pathInfo = buildArchivePathInfo(dateKey, partSlug, archiveRootDir);
      const exists = fs.existsSync(pathInfo.absolutePath);

      if (exists && !force) {
        partsSkipped += 1;
        downloadedFiles.push({
          partLabel: partLink.label,
          partSlug,
          relativePath: pathInfo.relativePath,
          status: 'skipped',
        });
        continue;
      }

      const pdfUrl = await extractPdfUrl(browser, partLink);
      const size = await downloadPdfToFile(pdfUrl, pathInfo.absolutePath);

      partsProcessed += 1;
      downloadedFiles.push({
        partLabel: partLink.label,
        partSlug,
        relativePath: pathInfo.relativePath,
        size,
        status: exists ? 'updated' : 'downloaded',
      });
    }

    return {
      dateKey,
      status: 'ok',
      partsFound: partLinks.length,
      partsProcessed,
      partsSkipped,
      downloadedFiles,
    };
  } finally {
    await browser.close();
  }
}

async function syncArchiveToday(options = {}) {
  const dateKey = options.dateKey || getBrazilDateKey();
  if (!dateKey) {
    throw new Error('Nao foi possivel calcular data atual em America/Sao_Paulo.');
  }
  return syncArchiveByDate(dateKey, options);
}

async function syncArchiveRange({ startDate, endDate, force = false, ...options }) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!start || !end) {
    throw new Error('Informe startDate e endDate no formato YYYY-MM-DD.');
  }

  let cursor = formatDateKey(start.year, start.month, start.day);
  const limit = formatDateKey(end.year, end.month, end.day);
  if (cursor > limit) {
    throw new Error('startDate nao pode ser maior que endDate.');
  }

  const results = [];
  let totalProcessedParts = 0;
  let totalSkippedParts = 0;
  let totalErrors = 0;

  while (cursor <= limit) {
    try {
      const result = await syncArchiveByDate(cursor, {
        ...options,
        force,
      });
      totalProcessedParts += Number(result.partsProcessed || 0);
      totalSkippedParts += Number(result.partsSkipped || 0);
      results.push(result);
    } catch (error) {
      totalErrors += 1;
      results.push({
        dateKey: cursor,
        status: 'error',
        error: error.message,
      });
    }

    cursor = addDays(cursor, 1);
  }

  return {
    startDate,
    endDate,
    totalDays: results.length,
    totalProcessedParts,
    totalSkippedParts,
    totalErrors,
    results,
  };
}

module.exports = {
  DEFAULT_ARCHIVE_DIR,
  getBrazilDateKey,
  addDays,
  syncArchiveByDate,
  syncArchiveToday,
  syncArchiveRange,
};
