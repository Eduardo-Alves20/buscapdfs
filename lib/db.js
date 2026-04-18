const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
      max: process.env.PGPOOL_MAX ? Number(process.env.PGPOOL_MAX) : 10,
    });
  }
  return pool;
}

async function ensureSchema() {
  const sql = `
    create table if not exists doerj_document (
      id bigserial primary key,
      relative_path text not null unique,
      absolute_path text not null,
      filename text not null,
      section_id text not null,
      section_label text not null,
      edition_date date not null,
      file_hash char(64) not null,
      file_size bigint not null default 0,
      text_content text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      extraction_version smallint not null default 1,
      search_tsv tsvector generated always as (to_tsvector('portuguese', coalesce(text_content, ''))) stored
    );

    create index if not exists idx_doerj_document_date on doerj_document (edition_date desc);
    create index if not exists idx_doerj_document_section on doerj_document (section_id);
    create index if not exists idx_doerj_document_hash on doerj_document (file_hash);
    create index if not exists idx_doerj_document_tsv on doerj_document using gin (search_tsv);
  `;
  await getPool().query(sql);
}

async function getDocumentHashByPath(relativePath) {
  const { rows } = await getPool().query(
    'select file_hash from doerj_document where relative_path = $1',
    [relativePath],
  );
  return rows[0]?.file_hash || null;
}

async function upsertDocument(payload) {
  const query = `
    insert into doerj_document (
      relative_path,
      absolute_path,
      filename,
      section_id,
      section_label,
      edition_date,
      file_hash,
      file_size,
      text_content,
      extraction_version,
      updated_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()
    )
    on conflict (relative_path) do update set
      absolute_path = excluded.absolute_path,
      filename = excluded.filename,
      section_id = excluded.section_id,
      section_label = excluded.section_label,
      edition_date = excluded.edition_date,
      file_hash = excluded.file_hash,
      file_size = excluded.file_size,
      text_content = excluded.text_content,
      extraction_version = excluded.extraction_version,
      updated_at = now()
  `;

  await getPool().query(query, [
    payload.relativePath,
    payload.absolutePath,
    payload.filename,
    payload.sectionId,
    payload.sectionLabel,
    payload.editionDate,
    payload.fileHash,
    payload.fileSize,
    payload.textContent,
    payload.extractionVersion || 1,
  ]);
}

async function searchIndexedDocuments({ keyword, dataInicio, dataFim, sections, limit }) {
  const clauses = [];
  const values = [];
  let idx = 1;

  const normalizedKeyword = String(keyword || '').trim();
  const safeLimit = Number(limit) > 0 ? Math.min(Number(limit), 5000) : 500;

  if (normalizedKeyword) {
    values.push(normalizedKeyword);
    clauses.push(`search_tsv @@ websearch_to_tsquery('portuguese', $${idx++})`);
  }
  if (dataInicio) {
    values.push(dataInicio);
    clauses.push(`edition_date >= $${idx++}::date`);
  }
  if (dataFim) {
    values.push(dataFim);
    clauses.push(`edition_date <= $${idx++}::date`);
  }
  if (sections && sections.length) {
    values.push(sections);
    clauses.push(`section_id = any($${idx++}::text[])`);
  }

  const whereSql = clauses.length ? `where ${clauses.join(' and ')}` : '';
  const keywordParam = normalizedKeyword ? `$1` : 'NULL';
  values.push(safeLimit);

  const sql = `
    select
      relative_path as "relativePath",
      filename,
      section_id as "sectionId",
      section_label as "sectionLabel",
      to_char(edition_date, 'DD/MM/YYYY') as date,
      case
        when ${keywordParam} is null then null
        else (
          (length(lower(text_content)) - length(replace(lower(text_content), lower(${keywordParam}), '')))
          / greatest(length(${keywordParam}), 1)
        )::int
      end as count,
      case
        when ${keywordParam} is null then left(regexp_replace(text_content, '\\s+', ' ', 'g'), 360)
        else ts_headline(
          'portuguese',
          text_content,
          websearch_to_tsquery('portuguese', ${keywordParam}),
          'StartSel=<mark class="term-highlight">,StopSel=</mark>,MaxWords=45,MinWords=20,ShortWord=2,MaxFragments=2,FragmentDelimiter= ... '
        )
      end as "highlightedSnippet"
    from doerj_document
    ${whereSql}
    order by edition_date desc, id desc
    limit $${idx}
  `;

  const { rows } = await getPool().query(sql, values);
  return rows.map(row => ({
    ...row,
    snippet: String(row.highlightedSnippet || '').replace(/<[^>]+>/g, ''),
  }));
}

async function closePool() {
  if (pool) await pool.end();
  pool = null;
}

module.exports = {
  getPool,
  ensureSchema,
  getDocumentHashByPath,
  upsertDocument,
  searchIndexedDocuments,
  closePool,
};
