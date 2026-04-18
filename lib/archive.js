const fs = require('fs');
const path = require('path');
const { getSectionId, getSectionLabel } = require('./sections');

const ARCHIVE_ROOT = path.resolve(__dirname, '..', 'doerj');

function parseIsoDate(str) {
  if (!str) return null;
  const [year, month, day] = String(str).split('-').map(Number);
  if (!year || !month || !day) return null;
  const value = new Date(year, month - 1, day);
  if (Number.isNaN(value.getTime())) return null;
  return value;
}

function buildArchiveDate(year, month, day) {
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function sanitizePath(filePath) {
  const resolved = path.resolve(filePath);
  const rootWithSep = `${ARCHIVE_ROOT}${path.sep}`;
  if (resolved !== ARCHIVE_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error('caminho-invalido');
  }
  return resolved;
}

function listArchivePdfFiles({ dataInicio = null, dataFim = null, sections = [] } = {}) {
  const start = dataInicio ? parseIsoDate(dataInicio) : null;
  const end = dataFim ? parseIsoDate(dataFim) : null;

  if (dataInicio && !start) throw new Error('data-inicio-invalida');
  if (dataFim && !end) throw new Error('data-fim-invalida');
  if (start && end && end < start) throw new Error('data-fim-antes-de-inicio');
  if (!fs.existsSync(ARCHIVE_ROOT)) return [];

  const files = [];
  const years = fs.readdirSync(ARCHIVE_ROOT).filter(year => /^\d{4}$/.test(year)).sort();

  for (const year of years) {
    const yearDir = path.join(ARCHIVE_ROOT, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;

    const months = fs.readdirSync(yearDir).filter(month => /^\d{2}$/.test(month)).sort();
    for (const month of months) {
      const monthDir = path.join(yearDir, month);
      if (!fs.statSync(monthDir).isDirectory()) continue;

      const days = fs.readdirSync(monthDir).filter(day => /^\d{2}$/.test(day)).sort();
      for (const day of days) {
        const editionDate = buildArchiveDate(year, month, day);
        if (start && editionDate < start) continue;
        if (end && editionDate > end) continue;

        const dayDir = path.join(monthDir, day);
        if (!fs.statSync(dayDir).isDirectory()) continue;

        const entries = fs.readdirSync(dayDir).filter(name => name.toLowerCase().endsWith('.pdf')).sort();
        for (const filename of entries) {
          const sectionId = getSectionId(filename);
          if (sections.length && !sections.includes(sectionId)) continue;

          const absolutePath = path.join(dayDir, filename);
          const relativePath = path.relative(path.resolve(__dirname, '..'), absolutePath).replace(/\\/g, '/');

          files.push({
            absolutePath,
            relativePath,
            filename,
            sectionId,
            sectionLabel: getSectionLabel(sectionId),
            editionDate: `${year}-${month}-${day}`,
          });
        }
      }
    }
  }

  return files;
}

module.exports = {
  ARCHIVE_ROOT,
  parseIsoDate,
  sanitizePath,
  listArchivePdfFiles,
};
