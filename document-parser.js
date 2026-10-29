import { parseNumber, parseCSV, round, STATES } from './calculator.js';

const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const numeric = '(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:[,.]\\d+)?';
const headerName = text => {
  text = normalize(text).trim().replace(/[.:]/g, '').replace(/\(r\$\)|r\$/g,'').trim().replace(/\s+/g, ' ');
  if (/^(descricao(?: d[oe]s? produtos?(?:\s*\/\s*servicos?)?)?|discriminacao|produto|item)$/.test(text)) return 'description';
  if (/^ncm(?:\/sh)?$/.test(text)) return 'ncm';
  if (/^(qtd|qtde|quant|quantidade)$/.test(text)) return 'quantity';
  if (/^(v(?:alor)? unit(?:ario)?|preco unit(?:ario)?|vl(?:r)? unit(?:ario)?|vr unit(?:ario)?)$/.test(text)) return 'price';
  if (/^(v(?:alor)? total|total|vl(?:r)? total)$/.test(text)) return 'total';
  if (/^(un|und|unid|unidade)$/.test(text)) return 'unit';
  if (/^(cod|codigo)$/.test(text)) return 'code';
  if (/^frete$/.test(text)) return 'freight';
  if (/^desconto$/.test(text)) return 'discount';
  return null;
};
function itemFromColumns(cells, columns) {
  const values = Object.fromEntries(columns.map((name,index)=>[name,cells[index]?.trim() ?? '']));
  const item = {description:values.description,ncm:values.ncm || '',quantity:parseNumber(values.quantity),price:parseNumber(values.price),freight:parseNumber(values.freight),other:0,discount:parseNumber(values.discount)};
  if (!item.description || !values.quantity || !values.price || item.quantity<=0 || item.price<0 || item.freight<0 || item.discount<0 || (item.ncm && !/^\d{8}$/.test(item.ncm))) return null;
  if (values.total && Math.abs(round(item.quantity*item.price)-parseNumber(values.total))>0.02) return null;
  return item;
}
export function parseDocumentText(text) {
  if (typeof text!=='string' || text.length>500000) throw new Error('Texto extraído inválido ou muito extenso.');
  const warnings=['Confira todos os itens contra o documento original. OCR pode trocar dígitos ou omitir linhas. Frete, seguro, IPI e descontos globais não são distribuídos automaticamente.'];
  const uf = label => { const match=normalize(text).match(new RegExp(`(?:^|\\n)\\s*(?:estado de )?${label}\\s*[:=-]\\s*([a-z]{2})\\b`)); const value=match?.[1].toUpperCase(); return STATES.includes(value) ? value : null; };
  const origin=uf('origem'), destination=uf('destino');
  const lines=text.split(/\r?\n/); let columns=null, simpleHeader=false, hasNcm=false, items=[], rejected=0;
  // Explicit CSV pasted from a document is also supported, with no fuzzy numeric inference.
  const csvStart=lines.findIndex(line=>/descricao/i.test(normalize(line)) && /quantidade/i.test(line) && /valor_unitario/i.test(line) && line.includes(';'));
  if (csvStart>=0) {
    try { items=parseCSV(lines.slice(csvStart).join('\n')); } catch { warnings.push('O trecho CSV contém erros; corrija as colunas antes de importar.'); }
  } else for (const line of lines) {
    const normalized=normalize(line);
    const cells=line.trim().split(/\s{2,}|\t+|\s*\|\s*/);
    const candidate=cells.map(headerName);
    if (candidate.includes('description') && candidate.includes('quantity') && candidate.includes('price') && new Set(candidate.filter(Boolean)).size===candidate.filter(Boolean).length) { columns=candidate; simpleHeader=false; continue; }
    // A compact OCR table is recognized only with an explicit simple column order.
    if (/^\s*(?:codigo\s+)?(?:descricao|produto)(?: do produto)?\s+(?:ncm\s+)?(?:qtd\.?|qtde\.?|quantidade)\s+(?:(?:un\.?|unidade)\s+)?(?:valor|v\.?|preco)\s*unit(?:ario)?\.?\s+(?:valor\s+)?total\s*$/.test(normalized)) { columns=null; simpleHeader=true; hasNcm=/\bncm\b/.test(normalized); continue; }
    if (/^\s*(?:total(?:\s|:)|subtotal|frete\b|desconto\b|observac|dados adicionais|base de calculo|valor do)/.test(normalized)) { columns=null; simpleHeader=false; continue; }
    let item=null;
    try {
      if (columns && cells.length===columns.length) item=itemFromColumns(cells,columns);
      else if (simpleHeader) {
        const pattern=new RegExp(`^(.+?)\\s+${hasNcm?'(\\d{8})\\s+':''}(${numeric})\\s+(?:[A-Za-z]{1,4}\\s+)?(?:R\\$\\s*)?(${numeric})\\s+(?:R\\$\\s*)?(${numeric})\\s*$`);
        const match=line.trim().match(pattern);
        if (match) item=itemFromColumns(match.slice(1), hasNcm?['description','ncm','quantity','price','total']:['description','quantity','price','total']);
      }
    } catch { item=null; }
    if (item) items.push(item);
    else if ((columns || simpleHeader) && /\d/.test(line)) rejected++;
  }
  if (items.length>500) throw new Error('Limite de 500 itens por leitura de documento.');
  if (rejected) warnings.push(`${rejected} linha(s) com números não puderam ser interpretadas com segurança. Confira o texto extraído e inclua os itens faltantes.`);
  if (!items.length) warnings.push('Não reconhecemos uma tabela de produtos compatível. Use o texto extraído como referência para preencher o CSV editável ou adicione os itens manualmente.');
  if (!origin || !destination) warnings.push('Confirme as UFs: só reconhecemos origem e destino quando estão explicitamente identificados.');
  return {items,origin,destination,warnings};
}
export function itemsToCSV(items) {
  const cell=value=>'"'+String(value).replaceAll('"','""')+'"';
  const rates=items.some(item=>item.interstateRate!==undefined);
  return ['descricao;ncm;quantidade;valor_unitario;frete;outras_despesas;desconto'+(rates?';icms_interestadual':''),...items.map(item=>[item.description,item.ncm,...['quantity','price','freight','other','discount'].map(key=>String(item[key]).replace('.',',')),...(rates?[item.interstateRate??'']:[])].map(cell).join(';'))].join('\n');
}
