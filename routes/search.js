const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const ARCHIVE_ROOT = path.resolve(__dirname, '..', 'doerj');
const SNIPPET_CONTEXT = 260;
const CONCURRENCY = 6;

const SECTION_OPTIONS = [
  { id: 'parte-i-poder-executivo', label: 'Parte I – Poder Executivo' },
  { id: 'parte-i-jc-junta-comercial', label: 'Parte I – Junta Comercial' },
  { id: 'parte-i-dpge-defensoria-publica-geral-do-estado', label: 'Parte I – Defensoria Pública' },
  { id: 'parte-ia-ministerio-publico', label: 'Parte IA – Ministério Público' },
  { id: 'parte-ib-tribunal-de-contas', label: 'Parte IB – Tribunal de Contas' },
  { id: 'parte-ii-poder-legislativo', label: 'Parte II – Poder Legislativo' },
  { id: 'parte-iv-municipalidades', label: 'Parte IV – Municipalidades' },
  { id: 'parte-v-publicacoes-a-pedido', label: 'Parte V – Publicações a Pedido' },
];

function getSectionId(filename) {
  return path.basename(filename, '.pdf').replace(/^\d{2}-/, '');
}

function getSectionLabel(sectionId) {
  const found = SECTION_OPTIONS.find(s => s.id === sectionId);
  return found ? found.label : sectionId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function parseDate(str) {
  const [year, month, day] = String(str || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const d = new Date(year, month - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

function sanitizePath(filePath) {
  const resolved = path.resolve(filePath);
  const rootWithSep = ARCHIVE_ROOT + path.sep;
  if (resolved !== ARCHIVE_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error('caminho-invalido');
  }
  return resolved;
}

function normalizeSections(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const validIds = SECTION_OPTIONS.map(s => s.id);
  return arr.filter(s => validIds.includes(s));
}

function escapeHtml(v) {
  return String(v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeRegex(v) {
  return String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSnippet(snippet, keyword) {
  if (!keyword) return escapeHtml(snippet);
  const pattern = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
  let result = '', lastIndex = 0;
  for (const match of snippet.matchAll(pattern)) {
    result += escapeHtml(snippet.slice(lastIndex, match.index));
    result += `<mark class="term-highlight">${escapeHtml(match[0])}</mark>`;
    lastIndex = match.index + match[0].length;
  }
  return result + escapeHtml(snippet.slice(lastIndex));
}

function listPdfs(dataInicio, dataFim, sections) {
  const start = dataInicio ? parseDate(dataInicio) : null;
  const end   = dataFim   ? parseDate(dataFim)   : null;
  if (dataInicio && !start) throw new Error('data-inicio-invalida');
  if (dataFim   && !end)   throw new Error('data-fim-invalida');
  if (start && end && end < start) throw new Error('data-fim-antes-de-inicio');

  const files = [];
  const years = fs.readdirSync(ARCHIVE_ROOT).filter(y => /^\d{4}$/.test(y)).sort();

  for (const year of years) {
    const yearDir = path.join(ARCHIVE_ROOT, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;

    for (const month of fs.readdirSync(yearDir).filter(m => /^\d{2}$/.test(m)).sort()) {
      const monthDir = path.join(yearDir, month);
      if (!fs.statSync(monthDir).isDirectory()) continue;

      for (const day of fs.readdirSync(monthDir).filter(d => /^\d{2}$/.test(d)).sort()) {
        if (start || end) {
          const fileDate = new Date(Number(year), Number(month) - 1, Number(day));
          if (start && fileDate < start) continue;
          if (end   && fileDate > end)   continue;
        }

        const dayDir = path.join(monthDir, day);
        if (!fs.statSync(dayDir).isDirectory()) continue;

        fs.readdirSync(dayDir)
          .filter(f => f.toLowerCase().endsWith('.pdf'))
          .filter(f => !sections.length || sections.includes(getSectionId(f)))
          .forEach(f => files.push({
            absolutePath: path.join(dayDir, f),
            relativePath: `doerj/${year}/${month}/${day}/${f}`,
            date: `${year}-${month}-${day}`,
            filename: f,
            sectionId: getSectionId(f),
            sectionLabel: getSectionLabel(getSectionId(f)),
          }));
      }
    }
  }

  return files;
}

// Retorna { count, snippet, highlightedSnippet } ou null se não encontrou
async function searchInPdf(fileInfo, keyword) {
  try {
    const buffer = fs.readFileSync(fileInfo.absolutePath);
    const data = await pdfParse(buffer, { max: 0 });
    const text = (data.text || '').replace(/\n{3,}/g, '\n\n');

    if (!keyword) {
      const preview = text.slice(0, 350).replace(/\n+/g, ' ').trim();
      return { count: null, snippet: preview, highlightedSnippet: escapeHtml(preview) };
    }

    const regex = new RegExp(escapeRegex(keyword), 'gi');
    const allMatches = [...text.matchAll(regex)];
    if (!allMatches.length) return null;

    const count = allMatches.length;
    const firstMatch = allMatches[0];
    const s = Math.max(0, firstMatch.index - SNIPPET_CONTEXT);
    const e = Math.min(text.length, firstMatch.index + keyword.length + SNIPPET_CONTEXT);
    const snippet =
      (s > 0 ? '…' : '') +
      text.slice(s, e).replace(/\n+/g, ' ').trim() +
      (e < text.length ? '…' : '');

    return { count, snippet, highlightedSnippet: highlightSnippet(snippet, keyword) };
  } catch {
    return null;
  }
}

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('index', { sectionOptions: SECTION_OPTIONS });
});

// ── GET /pdf ──────────────────────────────────────────────────────────────────
router.get('/pdf', (req, res) => {
  const rel = req.query.file || '';
  let absolutePath;
  try { absolutePath = sanitizePath(path.join(ARCHIVE_ROOT, '..', rel)); }
  catch { return res.status(400).send('Caminho inválido.'); }
  if (!fs.existsSync(absolutePath)) return res.status(404).send('Arquivo não encontrado.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(absolutePath)}"`);
  res.sendFile(absolutePath);
});

// ── GET /buscar  (SSE streaming) ──────────────────────────────────────────────
router.get('/buscar', async (req, res) => {
  const keyword    = String(req.query.keyword    || '').trim();
  const dataInicio = String(req.query.dataInicio || '').trim();
  const dataFim    = String(req.query.dataFim    || '').trim();
  const sections   = normalizeSections(req.query.sections);

  if (!keyword && !sections.length) {
    return res.status(400).json({ error: 'Digite uma palavra-chave ou selecione ao menos uma seção.' });
  }

  // Configura SSE
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.socket) res.socket.setNoDelay(true);
  res.flushHeaders();

  // Comentário SSE inicial — força o browser a abrir o canal imediatamente
  res.write(': connected\n\n');

  function send(obj) {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  // Avisa que está escaneando os arquivos (pode demorar alguns segundos)
  send({ type: 'scanning' });

  let pdfFiles;
  try {
    pdfFiles = listPdfs(dataInicio || null, dataFim || null, sections);
  } catch (err) {
    const msgs = {
      'data-inicio-invalida':     'Data de início inválida.',
      'data-fim-invalida':        'Data de fim inválida.',
      'data-fim-antes-de-inicio': 'A data de fim não pode ser anterior à data de início.',
    };
    send({ type: 'error', message: msgs[err.message] || err.message });
    return res.end();
  }

  const total = pdfFiles.length;
  let done = 0, found = 0, cancelled = false;

  req.on('close', () => { cancelled = true; });

  if (!total) {
    send({ type: 'done', found: 0, total: 0 });
    return res.end();
  }

  send({ type: 'progress', done: 0, total });

  const queue = [...pdfFiles];

  async function worker() {
    while (queue.length && !cancelled && !res.writableEnded) {
      const fileInfo = queue.shift();
      const result = await searchInPdf(fileInfo, keyword);
      done++;

      if (result) {
        found++;
        send({ type: 'result', ...fileInfo, count: result.count, snippet: result.snippet, highlightedSnippet: result.highlightedSnippet });
      }

      // Manda progresso a cada PDF processado
      send({ type: 'progress', done, total });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

  if (!res.writableEnded) {
    send({ type: 'done', found, total });
    res.end();
  }
});

module.exports = router;
