try { require('dotenv').config(); } catch (_) {}
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const searchRouter = require('./routes/search');
app.use('/', searchRouter);

const server = app.listen(PORT, () => {
  console.log(`Busca PDFs DOERJ rodando em http://localhost:${PORT}`);
});

// Timeout generoso para buscas em toda a base (8000+ PDFs podem demorar)
server.timeout = 30 * 60 * 1000; // 30 minutos
