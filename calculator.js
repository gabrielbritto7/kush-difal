export const STATES = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const SOUTH_SOUTHEAST = ['MG','PR','RJ','RS','SC','SP'];
export function interstateRate(origin, destination, imported = false) {
  if (!STATES.includes(origin) || !STATES.includes(destination)) throw new Error('Selecione UFs válidas.');
  if (origin === destination) return 0;
  if (imported) return 4;
  return SOUTH_SOUTHEAST.includes(origin) && !SOUTH_SOUTHEAST.includes(destination) ? 7 : 12;
}
export const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
export function calculate({ items, origin, destination, internalRate, interstate, fcp, eligible = true,useItemRates=true }) {
  for (const [name, value] of Object.entries({internalRate, interstate, fcp})) {
    if (!Number.isFinite(value) || value < 0 || value >= 100) throw new Error('Alíquota inválida: ' + name);
  }
  const rows = items.map(item => {
    const itemRate=useItemRates&&item.interstateRate!==undefined?item.interstateRate:interstate;
    if(!Number.isFinite(itemRate)||itemRate<0||itemRate>=100)throw new Error('Alíquota interestadual inválida no item '+item.description);
    if(internalRate<itemRate&&origin!==destination)throw new Error('A alíquota interna deve ser igual ou superior à interestadual.');
    for (const key of ['quantity','price','freight','other','discount']) {
      if (!Number.isFinite(item[key]) || item[key] < 0) throw new Error('Confira os valores do item ' + item.description);
    }
    if (item.quantity === 0) throw new Error('A quantidade deve ser maior que zero.');
    const base = round(item.quantity * item.price + item.freight + item.other - item.discount);
    if (base < 0) throw new Error('O desconto não pode superar o valor do item.');
    const applies = eligible && origin !== destination;
    const difal = applies ? round(base * (internalRate - itemRate) / 100) : 0;
    const povertyFund = applies ? round(base * fcp / 100) : 0;
    return { ...item, appliedInterstate:itemRate,base, difal, povertyFund, total: round(difal + povertyFund) };
  });
  return rows.reduce((result, row) => {
    result.rows.push(row);
    for (const key of ['base','difal','povertyFund','total']) result[key] = round(result[key] + row[key]);
    return result;
  }, { rows: [], base: 0, difal: 0, povertyFund: 0, total: 0 });
}

export function parseNumber(value) {
  let text = String(value ?? '').trim().replace(/R\$\s*/g, '').replace(/\s/g, '');
  if (!text) return 0;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error('Número inválido: ' + String(value).slice(0, 40));
  return n;
}

export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0];
  const delimiter = first.includes(';') ? ';' : ',';
  const records = []; let record = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (c === delimiter && !quoted) { record.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field); if (record.some(v => v.trim())) records.push(record); record = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV com aspas não fechadas.');
  record.push(field); if (record.some(v => v.trim())) records.push(record);
  if (records.length < 2) throw new Error('O CSV precisa conter cabeçalho e pelo menos um item.');
  const normalize = s => s.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '_');
  const headers = records.shift().map(normalize);
  for (const name of ['descricao','quantidade','valor_unitario']) if (!headers.includes(name)) throw new Error('Coluna obrigatória ausente: ' + name);
  return records.map((record, index) => {
    const get = name => record[headers.indexOf(name)] ?? '';
    if (!get('descricao').trim() || !get('quantidade').trim() || !get('valor_unitario').trim()) throw new Error('Preencha descrição, quantidade e valor unitário na linha ' + (index + 2));
    return { description: get('descricao').trim(), ncm: get('ncm').trim(), quantity: parseNumber(get('quantidade')), price: parseNumber(get('valor_unitario')), freight: parseNumber(get('frete')), other: parseNumber(get('outras_despesas')), discount: parseNumber(get('desconto')),...(get('icms_interestadual').trim()?{interstateRate:parseNumber(get('icms_interestadual'))}:{}) };
  });
}
