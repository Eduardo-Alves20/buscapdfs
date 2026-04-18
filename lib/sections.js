const SECTION_OPTIONS = [
  { id: 'parte-i-poder-executivo', label: 'Parte I - Poder Executivo' },
  { id: 'parte-i-jc-junta-comercial', label: 'Parte I - Junta Comercial' },
  { id: 'parte-i-dpge-defensoria-publica-geral-do-estado', label: 'Parte I - Defensoria Publica' },
  { id: 'parte-ia-ministerio-publico', label: 'Parte IA - Ministerio Publico' },
  { id: 'parte-ib-tribunal-de-contas', label: 'Parte IB - Tribunal de Contas' },
  { id: 'parte-ii-poder-legislativo', label: 'Parte II - Poder Legislativo' },
  { id: 'parte-iv-municipalidades', label: 'Parte IV - Municipalidades' },
  { id: 'parte-v-publicacoes-a-pedido', label: 'Parte V - Publicacoes a Pedido' },
];

function getSectionId(filename) {
  return String(filename || '').replace(/\.pdf$/i, '').replace(/^\d{2}-/, '');
}

function getSectionLabel(sectionId) {
  const found = SECTION_OPTIONS.find(section => section.id === sectionId);
  if (found) return found.label;
  return String(sectionId || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalizeSections(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const valid = new Set(SECTION_OPTIONS.map(section => section.id));
  return arr.filter(value => valid.has(value));
}

module.exports = {
  SECTION_OPTIONS,
  getSectionId,
  getSectionLabel,
  normalizeSections,
};
