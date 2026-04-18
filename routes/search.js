const express = require('express');
const path = require('path');
const fs = require('fs');
const { SECTION_OPTIONS, normalizeSections } = require('../lib/sections');
const { ARCHIVE_ROOT, sanitizePath, parseIsoDate } = require('../lib/archive');
const { searchIndexedDocuments, ensureSchema } = require('../lib/db');

const router = express.Router();
const MAX_RESULTS = Number(process.env.SEARCH_MAX_RESULTS || 1200);

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHighlightedSnippet(value) {
  const raw = String(value || '');
  const markerStart = '__MARK_START__';
  const markerEnd = '__MARK_END__';

  return escapeHtml(raw)
    .replace(/&lt;mark&gt;/g, markerStart)
    .replace(/&lt;\/mark&gt;/g, markerEnd)
    .replaceAll(markerStart, '<mark class="term-highlight">')
    .replaceAll(markerEnd, '</mark>');
}

async function validateDatabase() {
  try {
    await ensureSchema();
    return null;
  } catch (error) {
    return 'Banco nao conectado. Configure DATABASE_URL (ou variaveis PG*) e rode npm run db:init.';
  }
}

router.get('/', (req, res) => {
  res.render('index', { sectionOptions: SECTION_OPTIONS });
});

router.get('/pdf', (req, res) => {
  const rel = req.query.file || '';
  let absolutePath;
  try {
    absolutePath = sanitizePath(path.join(ARCHIVE_ROOT, '..', rel));
  } catch (_) {
    return res.status(400).send('Caminho invalido.');
  }

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).send('Arquivo nao encontrado.');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(absolutePath)}"`);
  return res.sendFile(absolutePath);
});

router.get('/buscar', async (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const dataInicio = String(req.query.dataInicio || '').trim();
  const dataFim = String(req.query.dataFim || '').trim();
  const sections = normalizeSections(req.query.sections);

  if (!keyword && !sections.length) {
    return res.status(400).json({ error: 'Digite uma palavra-chave ou selecione ao menos uma secao.' });
  }

  if (dataInicio && !parseIsoDate(dataInicio)) {
    return res.status(400).json({ error: 'Data inicio invalida.' });
  }
  if (dataFim && !parseIsoDate(dataFim)) {
    return res.status(400).json({ error: 'Data fim invalida.' });
  }
  if (dataInicio && dataFim && parseIsoDate(dataFim) < parseIsoDate(dataInicio)) {
    return res.status(400).json({ error: 'Data fim nao pode ser anterior a data inicio.' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.socket) res.socket.setNoDelay(true);
  res.flushHeaders();
  res.write(': connected\n\n');

  function send(obj) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    }
  }

  let disconnected = false;
  req.on('close', () => {
    disconnected = true;
  });

  send({ type: 'scanning' });
  const dbError = await validateDatabase();
  if (dbError) {
    send({ type: 'error', message: dbError });
    return res.end();
  }

  try {
    const rows = await searchIndexedDocuments({
      keyword,
      dataInicio: dataInicio || null,
      dataFim: dataFim || null,
      sections,
      limit: MAX_RESULTS,
    });

    const total = rows.length;
    send({ type: 'progress', done: 0, total });
    let done = 0;

    for (const row of rows) {
      if (disconnected || res.writableEnded) break;
      done += 1;
      send({
        type: 'result',
        ...row,
        highlightedSnippet: sanitizeHighlightedSnippet(row.highlightedSnippet),
      });
      send({ type: 'progress', done, total });
    }

    send({
      type: 'done',
      found: rows.length,
      total: rows.length,
      truncated: rows.length >= MAX_RESULTS,
      maxResults: MAX_RESULTS,
    });
    return res.end();
  } catch (error) {
    send({ type: 'error', message: `Falha ao consultar indice: ${error.message}` });
    return res.end();
  }
});

module.exports = router;
