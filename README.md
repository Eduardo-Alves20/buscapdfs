# Busca PDFs DOERJ (Indexada)

Busca historica em PDFs locais do DOERJ usando indice no PostgreSQL.
Este projeto agora funciona como sistema independente (sem dependencia do monitor-ioerj).

## 1) Configurar ambiente

1. Copie `.env.example` para `.env`.
2. Configure `DATABASE_URL` (ou variaveis `PG*`).

## 2) Instalar dependencias

```bash
npm install
```

## 3) Subir PostgreSQL com Docker

```bash
npm run db:docker:up
```

O compose sobe um PostgreSQL local em `localhost:5434`.

Para parar:

```bash
npm run db:docker:down
```

## 4) Criar esquema do banco

```bash
npm run db:init
```

## 5) Indexar acervo historico

```bash
npm run db:index
```

Opcoes:

```bash
npm run db:index -- --from 2018-01-01 --to 2026-12-31 --concurrency 2
```

## 6) Sincronizar PDFs do DOERJ (baixador proprio)

Sync do dia:

```bash
npm run archive:sync
```

Sync de data especifica:

```bash
npm run archive:sync -- --date=2026-04-18
```

Forcar refresh da data (rebaixar):

```bash
npm run archive:sync -- --date=2026-04-18 --force
```

Backfill por periodo:

```bash
npm run archive:backfill -- --start=2026-01-01 --end=2026-04-18
```

Daemon com cron (fica rodando sempre):

```bash
npm run archive:daemon
```

Padrao do daemon:
- janela 1: `ARCHIVE_SYNC_CRON=0 10 * * 1-5`
- janela 2: `ARCHIVE_SYNC_CRON_SECOND=0 20 * * 1-5`
- janela 2 com refresh forcado: `ARCHIVE_SYNC_CRON_SECOND_FORCE=true`
- retentativa do dia anterior: `ARCHIVE_SYNC_RETRY_PREVIOUS_DAY=true`

Os PDFs ficam em `./doerj/ANO/MES/DIA`.

## 7) Rodar a aplicacao

```bash
npm run dev
```

Se quiser embutir o daemon junto do servidor web:

```env
ARCHIVE_SYNC_EMBEDDED_DAEMON=true
```

## 8) Atualizacao diaria incremental

Depois de sincronizar novos PDFs do dia:

```bash
npm run db:index
```

Arquivos ja indexados (mesmo hash) sao ignorados automaticamente.

## Exportar / importar banco sem reextrair

Export:

```bash
pg_dump -Fc -d buscapdfs -f buscapdfs_snapshot.dump
```

Import:

```bash
createdb buscapdfs
pg_restore -d buscapdfs buscapdfs_snapshot.dump
```
