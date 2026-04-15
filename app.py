from __future__ import annotations

import re
from datetime import date
from pathlib import Path

import fitz  # PyMuPDF
import pandas as pd
import streamlit as st

# ── Configuração ──────────────────────────────────────────────────────────────

ARCHIVE_ROOT = Path(__file__).parent / "doerj"
SNIPPET_CONTEXT = 300  # caracteres antes/depois do match

SECTION_OPTIONS: dict[str, str] = {
    "parte-i-poder-executivo":                      "Parte I – Poder Executivo",
    "parte-i-jc-junta-comercial":                   "Parte I – Junta Comercial",
    "parte-i-dpge-defensoria-publica-geral-do-estado": "Parte I – Defensoria Pública",
    "parte-ia-ministerio-publico":                  "Parte IA – Ministério Público",
    "parte-ib-tribunal-de-contas":                  "Parte IB – Tribunal de Contas",
    "parte-ii-poder-legislativo":                   "Parte II – Poder Legislativo",
    "parte-iv-municipalidades":                     "Parte IV – Municipalidades",
    "parte-v-publicacoes-a-pedido":                 "Parte V – Publicações a Pedido",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def get_section_id(filename: str) -> str:
    return re.sub(r"^\d{2}-", "", Path(filename).stem)


def get_section_label(section_id: str) -> str:
    return SECTION_OPTIONS.get(
        section_id,
        section_id.replace("-", " ").title(),
    )


def list_pdfs(
    data_inicio: date | None,
    data_fim: date | None,
    sections: list[str],
) -> list[dict]:
    """Retorna lista de PDFs correspondentes aos filtros, do mais recente para o mais antigo."""
    files: list[dict] = []

    for year_dir in sorted(ARCHIVE_ROOT.iterdir(), reverse=True):
        if not year_dir.is_dir() or not re.match(r"^\d{4}$", year_dir.name):
            continue
        for month_dir in sorted(year_dir.iterdir(), reverse=True):
            if not month_dir.is_dir():
                continue
            for day_dir in sorted(month_dir.iterdir(), reverse=True):
                if not day_dir.is_dir():
                    continue
                try:
                    file_date = date(
                        int(year_dir.name),
                        int(month_dir.name),
                        int(day_dir.name),
                    )
                except ValueError:
                    continue

                if data_inicio and file_date < data_inicio:
                    continue
                if data_fim and file_date > data_fim:
                    continue

                for pdf in sorted(day_dir.glob("*.pdf")):
                    sid = get_section_id(pdf.name)
                    if sections and sid not in sections:
                        continue
                    files.append(
                        {
                            "path": pdf,
                            "date": str(file_date),
                            "filename": pdf.name,
                            "section_id": sid,
                            "section_label": get_section_label(sid),
                        }
                    )
    return files


def search_pdf(file_info: dict, keyword: str) -> dict | None:
    """
    Extrai texto do PDF com PyMuPDF e busca a keyword.
    Retorna dict com count e snippet, ou None se não encontrou.
    """
    try:
        doc = fitz.open(str(file_info["path"]))
        text = "".join(page.get_text() for page in doc)
        doc.close()

        if not keyword:
            snippet = text[:400].replace("\n", " ").strip()
            return {"count": None, "snippet": snippet}

        pattern = re.compile(re.escape(keyword), re.IGNORECASE)
        matches = list(pattern.finditer(text))
        if not matches:
            return None

        count = len(matches)
        m = matches[0]
        s = max(0, m.start() - SNIPPET_CONTEXT)
        e = min(len(text), m.end() + SNIPPET_CONTEXT)
        snippet = (
            ("…" if s > 0 else "")
            + text[s:e].replace("\n", " ").strip()
            + ("…" if e < len(text) else "")
        )
        return {"count": count, "snippet": snippet}
    except Exception:
        return None


def highlight(text: str, keyword: str) -> str:
    """Envolve a keyword com <mark> para highlight."""
    if not keyword:
        return text
    return re.sub(
        f"({re.escape(keyword)})",
        r"<mark>\1</mark>",
        text,
        flags=re.IGNORECASE,
    )


# ── CSS ───────────────────────────────────────────────────────────────────────

st.set_page_config(page_title="Busca DOERJ", layout="wide", page_icon="📄")

st.markdown(
    """
    <style>
    .block-container { padding-top: 2rem; }
    mark {
        background: #fef08a;
        color: #713f12;
        padding: 0 2px;
        border-radius: 3px;
        font-weight: 700;
    }
    .result-snippet {
        color: #374151;
        font-size: 0.93rem;
        line-height: 1.8;
    }
    .stExpander summary p { font-weight: 500; }
    </style>
    """,
    unsafe_allow_html=True,
)

# ── Cabeçalho ─────────────────────────────────────────────────────────────────

st.markdown("# 📄 Busca em PDFs do DOERJ")
st.caption("Pesquise o conteúdo textual dos PDFs locais · Acervo de 2018 em diante")
st.info(
    "O **período de datas é opcional** — sem datas, todos os PDFs da base são pesquisados. "
    "Os resultados aparecem conforme são encontrados, sem precisar esperar o fim.",
    icon="ℹ️",
)

# ── Formulário ────────────────────────────────────────────────────────────────

with st.form("busca"):
    c1, c2, c3 = st.columns([3, 1.5, 1.5])
    keyword     = c1.text_input("Palavra ou frase", placeholder="Ex: portaria, Eduardo Fernando, decreto…")
    data_inicio = c2.date_input("Data início (opcional)", value=None, format="DD/MM/YYYY")
    data_fim    = c3.date_input("Data fim (opcional)",   value=None, format="DD/MM/YYYY")

    st.markdown("**Seções do Diário** — deixe vazio para pesquisar todo o DOERJ")
    selected_labels = st.multiselect(
        "Seções",
        options=list(SECTION_OPTIONS.values()),
        label_visibility="collapsed",
    )
    selected_sections = [k for k, v in SECTION_OPTIONS.items() if v in selected_labels]

    buscar = st.form_submit_button("🔍 Buscar", type="primary", use_container_width=True)

# ── Busca ─────────────────────────────────────────────────────────────────────

if buscar:
    keyword = keyword.strip()

    if not keyword and not selected_sections:
        st.warning("⚠️ Digite uma palavra-chave ou selecione ao menos uma seção.")
        st.stop()

    st.divider()

    # 1. Escaneia arquivos
    with st.spinner("Escaneando arquivos no disco…"):
        pdfs = list_pdfs(data_inicio, data_fim, selected_sections)

    if not pdfs:
        st.warning("Nenhum PDF encontrado para os critérios informados. Verifique as datas e seções.")
        st.stop()

    # 2. Barra de progresso
    progress = st.progress(0.0, text=f"0 / {len(pdfs):,} PDFs  |  0 encontrado(s)")

    results: list[dict] = []
    live_table = st.empty()  # tabela ao vivo durante a busca

    # 3. Processa cada PDF
    for i, file_info in enumerate(pdfs):
        result = search_pdf(file_info, keyword)
        if result:
            results.append({**file_info, **result})

        pct = (i + 1) / len(pdfs)
        progress.progress(
            min(pct, 1.0),
            text=f"Buscando… {i + 1:,} / {len(pdfs):,} PDFs  |  {len(results):,} encontrado(s)",
        )

        # Atualiza tabela ao vivo a cada resultado encontrado
        if result and results:
            df = pd.DataFrame(
                [
                    {
                        "Data":    r["date"],
                        "Seção":   r["section_label"],
                        "Menções": r["count"] if r["count"] is not None else "—",
                        "Trecho":  (r["snippet"][:120] + "…") if len(r["snippet"]) > 120 else r["snippet"],
                    }
                    for r in results
                ]
            )
            live_table.dataframe(df, use_container_width=True, hide_index=True)

    progress.progress(
        1.0,
        text=f"✅ Concluído — {len(results):,} PDF(s) com ocorrência em {len(pdfs):,} lidos",
    )

    # 4. Resultado final
    if not results:
        live_table.info("ℹ️ Nenhuma ocorrência encontrada para os critérios informados.")
        st.stop()

    live_table.empty()  # substitui a tabela ao vivo pelos cards detalhados

    st.markdown(f"### 📋 {len(results):,} PDF(s) com ocorrência")

    for r in results:
        count_label = f"  |  **{r['count']} menção(ões)**" if r["count"] else ""
        header = f"📄 {r['date']}  |  {r['section_label']}{count_label}"

        with st.expander(header):
            col_info, col_btn = st.columns([5, 1])

            with col_info:
                st.markdown(f"**Arquivo:** `{r['filename']}`")
                st.markdown("**Primeiro trecho encontrado:**")
                st.markdown(
                    f"<div class='result-snippet'>{highlight(r['snippet'], keyword)}</div>",
                    unsafe_allow_html=True,
                )

            with col_btn:
                with open(r["path"], "rb") as f:
                    pdf_bytes = f.read()
                st.download_button(
                    "⬇️ Baixar PDF",
                    data=pdf_bytes,
                    file_name=r["filename"],
                    mime="application/pdf",
                    key=f"dl_{r['date']}_{r['section_id']}",
                    use_container_width=True,
                )
