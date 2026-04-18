try { require('dotenv').config(); } catch (_) {}
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '');

function normalizeBasePath(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '/') return '';
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return normalized.replace(/\/+$/, '');
}

function withBasePath(route) {
  const normalizedRoute = String(route || '').startsWith('/') ? String(route || '') : `/${route || ''}`;
  if (!BASE_PATH) return normalizedRoute;
  if (normalizedRoute === '/') return `${BASE_PATH}/`;
  return `${BASE_PATH}${normalizedRoute}`;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.basePath = BASE_PATH;
app.locals.withBasePath = withBasePath;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use((req, res, next) => {
  res.locals.basePath = BASE_PATH;
  res.locals.withBasePath = withBasePath;
  next();
});

app.use(BASE_PATH || '/', express.static(path.join(__dirname, 'public')));

const searchRouter = require('./routes/search');
app.use(BASE_PATH || '/', searchRouter);

if (process.env.ARCHIVE_SYNC_EMBEDDED_DAEMON === 'true') {
  require('./scripts/archive-daemon');
}

const server = app.listen(PORT, () => {
  console.log(`Busca PDFs DOERJ rodando em http://localhost:${PORT}${BASE_PATH || '/'}`);
});

// Timeout generoso para buscas em toda a base (8000+ PDFs podem demorar)
server.timeout = 30 * 60 * 1000; // 30 minutos
