try { require('dotenv').config(); } catch (_) {}
const { ensureSchema, closePool } = require('../lib/db');

async function main() {
  await ensureSchema();
  console.log('Banco inicializado com sucesso (tabelas e indices criados).');
}

main()
  .catch(error => {
    console.error('Falha ao inicializar banco:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
