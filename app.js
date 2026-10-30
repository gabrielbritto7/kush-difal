import { readDocument, readerStatus } from './browser-reader.js';
import { itemsToCSV } from './document-parser.js';
import { STATES, interstateRate, calculate, parseCSV, parseNumber, round,productValue,productTotal } from './calculator.js';
import { ICMS_REFERENCE,destinationInternalRate } from './icms-rates.js';

const $ = id => document.getElementById(id);
const money = value => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const names = { AC:'Acre', AL:'Alagoas', AP:'Amapá', AM:'Amazonas', BA:'Bahia', CE:'Ceará', DF:'Distrito Federal', ES:'Espírito Santo', GO:'Goiás', MA:'Maranhão', MT:'Mato Grosso', MS:'Mato Grosso do Sul', MG:'Minas Gerais', PA:'Pará', PB:'Paraíba', PR:'Paraná', PE:'Pernambuco', PI:'Piauí', RJ:'Rio de Janeiro', RN:'Rio Grande do Norte', RS:'Rio Grande do Sul', RO:'Rondônia', RR:'Roraima', SC:'Santa Catarina', SP:'São Paulo', SE:'Sergipe', TO:'Tocantins' };
let items = [], result = null, editing = -1, sourceName = 'Inclusão manual',invoiceRoute=null;
let readerAvailable=false, readerLoading=false, pendingDocument=null, readerVersion=0, readerRows=[], readerCSVInvalid=false;
let history = [];
try { const saved = JSON.parse(localStorage.getItem('kush-history') || '[]'); if (Array.isArray(saved)) history = saved.filter(x => x && STATES.includes(x.origin) && STATES.includes(x.destination) && Number.isFinite(x.total) && Number.isFinite(x.base) && Number.isFinite(x.count) && Number.isFinite(new Date(x.date).getTime())).slice(0, 20); } catch {}
for (const id of ['origin','destination']) {
  $(id).add(new Option('Selecione a UF', ''));
  for (const uf of STATES) $(id).add(new Option(`${uf} — ${names[uf]}`, uf));
}
$('origin').value = ''; $('destination').value = '';
function suggestInternalRate(documentRate=null){
  const destination=$('destination').value,reference=destinationInternalRate(destination);
  const fromDocument=Number.isFinite(documentRate)&&documentRate>=0&&documentRate<100;
  $('internal-rate').value=fromDocument?documentRate:reference??'';
  $('internal-rate').dataset.source=fromDocument?'document':reference===null?'none':'table';
  const date=ICMS_REFERENCE.sourceUpdatedAt.split('-').reverse().join('/');
  $('internal-rate-status').textContent=fromDocument?'ICMS interno preenchido com a alíquota informada no XML da NF-e.':reference===null?'O ICMS interno será preenchido automaticamente ao identificar ou selecionar o destino.':`ICMS interno de ${destination} preenchido automaticamente pela tabela de ${date}.`;
}
function applyDocumentRoute(parsed){
  for(const role of ['origin','destination'])$(role).value=STATES.includes(parsed[role])?parsed[role]:'';
  suggestInternalRate(parsed.internalRate);
  const identified=[['origin','Origem'],['destination','Destino']].map(([role,label])=>`${label}: ${parsed[role]||(role==='origin'?'não identificada':'não identificado')}${parsed.routeSources?.[role]?` (${parsed.routeSources[role]})`:''}.`);
  $('route-status').textContent=identified.join(' ')+' Você pode alterar os estados nos campos acima.';
}
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); $('message').hidden = !text; }
function settings() {
  if (!STATES.includes($('origin').value) || !STATES.includes($('destination').value)) throw new Error('Selecione os estados de origem e destino.');
  if (!$('internal-rate').value.trim()) throw new Error('Informe a alíquota interna do destino antes de calcular.');
  if (!$('interstate-rate').value.trim() || !$('fcp-rate').value.trim()) throw new Error('Preencha as alíquotas interestadual e FCP (use zero quando não aplicável).');
  if (!$('eligible').checked) throw new Error('Esta versão cobre consumidor final não contribuinte. Para outras operações, é necessária análise tributária específica.');
  return { origin: $('origin').value, destination: $('destination').value, internalRate: Number($('internal-rate').value), interstate: Number($('interstate-rate').value), fcp: Number($('fcp-rate').value), eligible: true,internalRateSource:$('internal-rate').dataset.source||'manual',useItemRates:usesInvoiceRates() };
}
function usesInvoiceRates(){return !!($('use-invoice-rates').checked&&invoiceRoute&&$('origin').value===invoiceRoute.origin&&$('destination').value===invoiceRoute.destination&&!$('imported').checked&&items.some(item=>item.interstateRate!==undefined));}
function updateInvoiceRates(){
  const rates=[...new Set(items.map(item=>item.interstateRate).filter(Number.isFinite))].sort((a,b)=>a-b),matches=invoiceRoute&&$('origin').value===invoiceRoute.origin&&$('destination').value===invoiceRoute.destination;
  $('invoice-rates-control').hidden=!rates.length||!invoiceRoute;
  $('interstate-rate').readOnly=!!usesInvoiceRates();
  $('invoice-rates-note').textContent=!matches?'A rota foi alterada. O cálculo usa a taxa geral; as alíquotas da nota só voltam a ser aplicadas na rota original.':$('imported').checked?'A regra de mercadoria importada está ativa: a taxa geral de 4% será aplicada a todos os produtos.':!$('use-invoice-rates').checked?'As alíquotas por item estão desativadas. O cálculo usa a taxa interestadual geral.':`A nota informa ${rates.map(rate=>rate+'%').join(' e ')} por produto. O cálculo preserva a alíquota de cada item; a taxa geral atende somente itens sem alíquota informada.`;
}
function setInvoiceRates(parsed){invoiceRoute=STATES.includes(parsed.origin)&&STATES.includes(parsed.destination)?{origin:parsed.origin,destination:parsed.destination}:null;$('use-invoice-rates').checked=true;updateInvoiceRates();}
function clearResult() {
  result = null; $('export-button').disabled = true;
  $('summary-origin').textContent = $('origin').value || '—'; $('summary-destination').textContent = $('destination').value || '—';
  $('summary-difal').textContent = money(0); $('summary-fcp').textContent = money(0);
  $('summary-total').textContent = money(0);
  $('summary-grand-total').textContent='—';
  $('difal-percent').textContent = '—'; $('fcp-percent').textContent = `${$('fcp-rate').value || 0}%`;
  $('summary-caption').textContent = items.length ? 'Confira as alíquotas e calcule para ver o resultado.' : 'Tudo o que você precisa, em um só lugar.';
  $('calculate-button').firstChild.textContent = 'Calcular DIFAL ';
}
function baseTotal() { return productTotal(items); }
function renderItems() {
  updateInvoiceRates();clearResult(); $('items-body').replaceChildren();
  $('items-empty').hidden = !!items.length; $('items-container').hidden = !items.length;
  $('item-count').textContent = `${items.length} ${items.length === 1 ? 'item' : 'itens'}`;
  $('base-total').textContent = $('summary-base').textContent = money(baseTotal());
  items.forEach((item, index) => {
    const row = document.createElement('tr');
    const description = document.createElement('td'), strong = document.createElement('strong'), small = document.createElement('small');
    strong.textContent = item.description; small.textContent = (item.ncm ? `NCM ${item.ncm}` : 'NCM não informado')+(item.interstateRate===undefined?'':` · ICMS da NF: ${item.interstateRate}%`); description.append(strong, small); row.append(description);
    for (const value of [item.quantity.toLocaleString('pt-BR'), money(item.price), money(productValue(item))]) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
    const actions = document.createElement('td');
    for (const [text, title, action, cls] of [['✎','Editar item',() => openItem(index),''],['×','Remover item',() => { items.splice(index,1); renderItems(); },'remove']]) {
      const button = document.createElement('button'); button.textContent = text; button.title = title; button.setAttribute('aria-label', title + ' ' + item.description); button.className = 'row-button ' + cls; button.onclick = action; actions.append(button);
    }
    row.append(actions); $('items-body').append(row);
  });
}
function suggestRate() { $('interstate-rate').value = STATES.includes($('origin').value) && STATES.includes($('destination').value) ? interstateRate($('origin').value, $('destination').value, $('imported').checked) : '';updateInvoiceRates(); clearResult(); }
for (const id of ['origin','imported']) $(id).addEventListener('change', suggestRate);
$('destination').addEventListener('change',()=>{suggestInternalRate();suggestRate();});
for(const role of ['origin','destination'])$(role).addEventListener('change',()=>{$('route-status').textContent='Estados ajustados por você. A alíquota interestadual acompanha a rota selecionada.';});
for (const id of ['internal-rate','interstate-rate','fcp-rate','eligible']) $(id).addEventListener('input', clearResult);
$('use-invoice-rates').addEventListener('change',()=>{updateInvoiceRates();clearResult();});
$('internal-rate').addEventListener('input',()=>{$('internal-rate').dataset.source='manual';$('internal-rate-status').textContent='ICMS interno ajustado por você. Ao trocar o destino, o site volta à alíquota da tabela.';});
function openItem(index = -1) {
  editing = index; $('item-form').reset(); $('item-error').textContent = '';
  $('item-dialog-title').textContent = index < 0 ? 'Adicionar item' : 'Editar item';
  if (index >= 0) for (const [key,value] of Object.entries(items[index])) if ($('item-form').elements.namedItem(key)) $('item-form').elements.namedItem(key).value = value;
  $('item-dialog').showModal();
}
$('manual-button').onclick = () => openItem(); $('add-item').onclick = () => openItem();
$('item-form').onsubmit = event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
  const item = { ...(editing>=0?items[editing]:{}),...data, description: data.description.trim() };
  for (const key of ['quantity','price','freight','other','discount']) item[key] = Number(data[key]);
  try {
    if (!item.description) throw new Error('Informe a descrição do produto.');
    calculate({ items: [item], origin:'SP',destination:'RJ',internalRate:18,interstate:12,fcp:0 });
    if (editing < 0) items.push(item); else items[editing] = item;
    renderItems(); $('item-dialog').close(); message('Item salvo. Confira os dados da operação antes de calcular.');
  } catch (error) { $('item-error').textContent = error.message; }
};
for (const button of document.querySelectorAll('.close-dialog')) button.onclick = () => button.closest('dialog').close();
$('learn-button').onclick = () => $('guide-dialog').showModal();
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('template-button').onclick = () => download('\uFEFFdescricao;ncm;quantidade;valor_unitario;frete;outras_despesas;desconto\nProduto de exemplo;94036000;2;150,00;20,00;0;0\n','modelo-orcamento-kush.csv','text/csv;charset=utf-8');
$('upload-button').onclick = () => $('file-input').click();
$('file-input').onchange = async event => { const file = event.target.files[0]; if (file) await importFile(file); event.target.value = ''; };
for (const type of ['dragenter','dragover']) $('dropzone').addEventListener(type, event => { event.preventDefault(); $('dropzone').classList.add('dragover'); });
for (const type of ['dragleave','drop']) $('dropzone').addEventListener(type, event => { event.preventDefault(); $('dropzone').classList.remove('dragover'); });
$('dropzone').addEventListener('drop', event => { if (event.dataTransfer.files.length !== 1) message('Importe um documento por vez.',true); else importFile(event.dataTransfer.files[0]); });
function parseXML(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML com declarações externas não é aceito. Use o XML original da NF-e.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('O XML está inválido ou incompleto.');
  const nodes = (parent, name) => [...parent.getElementsByTagNameNS('*', name)];
  const value = (parent, name) => nodes(parent, name)[0]?.textContent.trim() || '';
  const info = nodes(doc, 'infNFe');
  if (info.length !== 1) throw new Error('Selecione um XML com exatamente uma NF-e.');
  const nf = info[0];
  const origin = value(nodes(nf, 'enderEmit')[0] || nf, 'UF');
  const destination = value(nodes(nf, 'enderDest')[0] || nf, 'UF');
  if (!STATES.includes(origin) || !STATES.includes(destination)) throw new Error('Não foi possível identificar as UFs do emitente e destinatário.');
  const number = (parent, name) => { const raw = value(parent,name); const n = raw ? Number(raw) : 0; if (!Number.isFinite(n)) throw new Error('Valor inválido no XML: ' + name); return n; };
  let baseWarning = false;
  const items = nodes(nf, 'det').map(det => {
    const product = nodes(det,'prod')[0]; if (!product) throw new Error('Item do XML sem dados do produto.');
    const quantity = number(product,'qCom');
    if (quantity <= 0) throw new Error('Quantidade inválida em um item do XML.');
    const declaredValue = value(product,'vProd');
    // vProd is authoritative: vUnCom may have more precision than the invoiced total.
    const price = declaredValue ? number(product,'vProd') / quantity : number(product,'vUnCom');
    if (nodes(det,'ICMSST').length || nodes(det,'vICMSST').some(n => Number(n.textContent) > 0) || nodes(det,'pRedBC').some(n => Number(n.textContent) > 0) || nodes(det,'vII').some(n => Number(n.textContent) > 0)) baseWarning = true;
    const printedRate=value(det,'pICMSInter')||value(det,'pICMS'),itemRate=Number(printedRate);
    return { description: value(product,'xProd') || 'Produto sem descrição', ncm: value(product,'NCM'), quantity, price, freight: number(product,'vFrete'), other: number(product,'vOutro') + number(product,'vSeg') + number(det,'vIPI'), discount: number(product,'vDesc'),...(origin!==destination&&printedRate&&[4,7,12].includes(itemRate)?{interstateRate:itemRate}:{}) };
  });
  const rates = nodes(nf, 'ICMSUFDest');
  const total=nodes(nf,'ICMSTot')[0];
  if(total&&value(total,'vProd')&&Math.abs(productTotal(items)-number(total,'vProd'))>.021)throw new Error('A soma dos itens do XML difere do valor total dos produtos. Confira o arquivo.');
  const uniform = tag => { const values = rates.map(rate => value(rate,tag)); return values.length === items.length && values.every(x => x !== '' && x === values[0]) ? Number(values[0]) : null; };
  return { items, origin, destination, internalRate:uniform('pICMSUFDest'), interstate:uniform('pICMSInter'), fcp:uniform('pFCPUFDest'), eligible:value(nf,'indFinal') === '1' && value(nf,'indIEDest') === '9', baseWarning, mixed: rates.length > 0 && uniform('pICMSUFDest') === null };
}
async function importFile(file) {
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('O arquivo excede 5 MB.');
    const extension = file.name.split('.').pop().toLowerCase();
    if (['pdf','png','jpg','jpeg','webp'].includes(extension)) {
      const transfer=new DataTransfer(); transfer.items.add(file); $('reader-file').files=transfer.files;
      clearPendingDocument(); await $('reader-button').onclick(); await $('reader-submit').onclick(); return;
    }
    if (!['xml','csv'].includes(extension)) throw new Error('Para PDF e imagens, use a opção “Ler PDF / foto”. Orçamentos XLSX devem ser exportados para CSV.');
    const text = await file.text(); const parsed = extension === 'xml' ? parseXML(text) : {items:parseCSV(text)};
    if (!parsed.items.length) throw new Error('Nenhum item encontrado no arquivo.');
    if (parsed.items.length > 2000) throw new Error('Limite de 2.000 itens por documento.');
    calculate({items:parsed.items,origin:parsed.origin || 'SP',destination:parsed.destination || 'RJ',internalRate:18,interstate:12,fcp:0});
    if (items.length && !window.confirm('Substituir os itens atuais pelos itens deste documento?')) return;
    // Replace document settings too, so rates from a previous invoice cannot leak into a new import.
    $('fcp-rate').value = parsed.fcp ?? 0;
    $('eligible').checked = parsed.eligible ?? true; $('imported').checked = parsed.interstate === 4;
    applyDocumentRoute(parsed);
    suggestRate();
    if (parsed.interstate !== null && parsed.interstate !== undefined) $('interstate-rate').value = parsed.interstate;
    items = parsed.items;setInvoiceRates(parsed); sourceName = file.name; renderItems();
    $('file-name').textContent = file.name; $('file-details').textContent = `${items.length} itens · ${(file.size / 1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} KB · processamento local`; $('file-info').hidden = false;
    let notice = 'Documento importado. Confira os itens, o enquadramento e as alíquotas antes de calcular.';
    if (parsed.mixed) notice += ' Há alíquotas internas ou informações de DIFAL diferentes/incompletas no XML. Confira o enquadramento; as alíquotas interestaduais reconhecidas são preservadas por item.';
    if (parsed.baseWarning) notice += ' Detectados tributos ou redução de base que exigem conferência fiscal; a base simplificada pode não se aplicar.';
    if (extension === 'xml' && !parsed.eligible) notice += ' A NF-e não está marcada como consumidor final não contribuinte; confira a modalidade antes de continuar.';
    message(notice, !!parsed.baseWarning || !!parsed.mixed || (extension === 'xml' && !parsed.eligible));
  } catch (error) { message(error.message, true); }
}
$('calculate-button').onclick = () => {
  try {
    if (!items.length) throw new Error('Importe um documento ou adicione pelo menos um item para calcular.');
    const config = settings(); const totals = calculate({ items, ...config }); result = { ...totals, ...config, date: new Date().toISOString(), sourceName };
    $('summary-base').textContent = money(result.base); $('summary-difal').textContent = money(result.difal); $('summary-fcp').textContent = money(result.povertyFund); $('summary-total').textContent = money(result.total);
    $('summary-grand-total').textContent=money(round(result.base+result.total));
    const applied=[...new Set(totals.rows.map(row=>row.appliedInterstate))];
    $('difal-percent').textContent = applied.length>1?'por item':`${config.origin === config.destination ? 0 : round(config.internalRate-(applied[0]??config.interstate))}%`; $('fcp-percent').textContent = `${config.fcp}%`;
    $('summary-caption').textContent = `Calculado com ${items.length} ${items.length === 1 ? 'item' : 'itens'} · base: produtos`;
    $('export-button').disabled = false;
    history.unshift({ date: result.date, origin:config.origin,destination:config.destination,total:result.total,base:result.base,count:items.length }); history = history.slice(0,20); persistHistory();
    message(config.origin === config.destination ? 'Origem e destino são iguais: não há DIFAL interestadual nesta simulação.' : 'Simulação concluída. Confira o enquadramento fiscal antes de recolher. Você já pode exportar a memória de cálculo.');
  } catch (error) { clearResult(); message(error.message,true); }
};
function persistHistory() { try { localStorage.setItem('kush-history',JSON.stringify(history)); } catch { message('Cálculo concluído, mas o navegador não permitiu salvar o histórico.'); } $('history-count').textContent = history.length; }
function renderHistory() {
  $('history-list').replaceChildren();
  if (!history.length) { const p = document.createElement('p'); p.className = 'field-help'; p.textContent = 'Nenhum cálculo por aqui ainda. Seus próximos resultados aparecerão neste espaço.'; $('history-list').append(p); }
  history.forEach(entry => {
    const row = document.createElement('div'); row.className='history-entry'; const text = document.createElement('div'), small = document.createElement('small'), total = document.createElement('strong');
    text.textContent = `${entry.origin} → ${entry.destination} · ${entry.count} itens`; small.textContent = new Date(entry.date).toLocaleString('pt-BR') + ' · Base: ' + money(entry.base); total.textContent = money(entry.total); text.append(small); row.append(text,total); $('history-list').append(row);
  });
}
$('history-button').onclick = () => { renderHistory(); $('history-dialog').showModal(); };
$('clear-history').onclick = () => { if (history.length && !window.confirm('Apagar o histórico deste navegador?')) return; history = []; persistHistory(); renderHistory(); };
$('export-button').onclick = () => {
  if (!result) return;
  // Spreadsheet formula injection prevention also applies to imported product names.
  const cell = value => { let text = String(value); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"','""') + '"'; };
  const lines = [['Kush — Simulação DIFAL sobre o total dos produtos'],['Data',new Date(result.date).toLocaleString('pt-BR')],['Documento',result.sourceName],['Origem',result.origin,'Destino',result.destination],['ICMS interno (%)',result.internalRate,'ICMS interestadual geral (%)',result.interstate,'FCP (%)',result.fcp],['Critério da base','Total dos produtos; valores complementares e total da nota são informativos'],[],['Descrição','NCM','Quantidade','Valor unitário','Frete informado (fora da base)','Despesas / IPI informados (fora da base)','Desconto informado (fora da base)','ICMS interestadual aplicado (%)','Base (produtos)','DIFAL','FCP','Total']];
  if(result.internalRateSource==='table')lines.splice(5,0,['Fonte do ICMS interno',ICMS_REFERENCE.source,'Atualização informada',ICMS_REFERENCE.sourceUpdatedAt,'Consulta',ICMS_REFERENCE.retrievedAt]);
  const num = value => value.toLocaleString('pt-BR',{maximumFractionDigits:8,useGrouping:false});
  for (const row of result.rows) lines.push([row.description,row.ncm,...['quantity','price','freight','other','discount','appliedInterstate','base','difal','povertyFund','total'].map(key=>num(row[key]))]);
  lines.push([],['Base total dos produtos',num(result.base)],['DIFAL total',num(result.difal)],['FCP total',num(result.povertyFund)],['Total a recolher estimado',num(result.total)],['Valor total com DIFAL e FCP',num(round(result.base+result.total))],[],['Critério desta simulação: total dos produtos. A base legal de ICMS pode exigir outros componentes conforme a operação. Confirme enquadramento, NCM e legislação antes de recolher. Não contempla ICMS-ST, benefícios fiscais ou base dupla.']);
  download('\uFEFF' + lines.map(row => row.map(cell).join(';')).join('\r\n'),`difal-${result.origin}-${result.destination}-${result.date.slice(0,10)}.csv`,'text/csv;charset=utf-8');
};
$('new-button').onclick = () => {
  if (items.length && !window.confirm('Limpar os dados e iniciar um novo cálculo?')) return;
  items=[];invoiceRoute=null; sourceName='Inclusão manual'; $('origin').value=''; $('destination').value=''; $('route-status').textContent='Os estados serão preenchidos a partir dos endereços do documento. Você pode alterar a seleção.'; suggestInternalRate(); $('interstate-rate').value=''; $('fcp-rate').value=0; $('imported').checked=false; $('eligible').checked=true; $('file-info').hidden=true; message(''); renderItems();
};
$('history-count').textContent = history.length;
renderItems();

$('reader-button').onclick=async()=>{
  $('reader-dialog').showModal();$('reader-error').textContent='';
  readerAvailable=readerStatus().enabled;
  $('reader-status').textContent=readerAvailable?'IA no navegador pronta para carregar. Selecione um documento para reconhecer os produtos automaticamente.':'Este navegador não oferece suporte à IA local. Atualize-o ou use um navegador recente.';
  updateReaderButtons();
};
function updateReaderButtons(){
  $('reader-submit').disabled=!readerAvailable||readerLoading||!$('reader-file').files.length;
  $('reader-import').disabled=readerLoading||!pendingDocument||!pendingDocument.verification?.complete||pendingDocument.blocked||!$('reader-reviewed').checked;
  $('reader-file').disabled=readerLoading;
}
function clearPendingDocument() { readerVersion++; pendingDocument=null; $('reader-review').hidden=true; $('reader-reviewed').checked=false; updateReaderButtons(); }
$('reader-file').onchange=async()=>{clearPendingDocument();if(readerAvailable)await $('reader-submit').onclick();};
$('reader-reviewed').onchange=updateReaderButtons;
function renderReaderRows(){
  $('reader-products').replaceChildren();
  readerRows.forEach((row,index)=>{
    const card=document.createElement('div');card.className='reader-product';
    const heading=document.createElement('div');heading.className='reader-product-title';const title=document.createElement('strong');title.textContent=`Produto ${index+1}`;
    const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Remover';remove.onclick=()=>{readerRows.splice(index,1);renderReaderRows();syncReaderCSV();};heading.append(title,remove);card.append(heading);
    for(const fields of [[['description','Descrição do produto'],['ncm','NCM (opcional)']],[['quantity','Quantidade'],['price','Valor unitário (R$)']],[['freight','Frete (R$)'],['other','Despesas + IPI (R$)'],['discount','Desconto (R$)']]]){
      const group=document.createElement('div');group.className='field-row';
      for(const [key,labelText]of fields){const label=document.createElement('label');label.textContent=labelText;const input=document.createElement('input');input.dataset.field=key;input.dataset.row=index;input.value=row[key]??'';input.required=['description','quantity','price'].includes(key);input.maxLength=key==='description'?500:key==='ncm'?8:30;
        if(key!=='description'&&key!=='ncm')input.inputMode='decimal';if(key==='ncm')input.pattern='[0-9]{8}|';
        input.oninput=()=>{row[key]=input.value;syncReaderCSV();};label.append(input);group.append(label);}
      if(fields[0][0]==='freight'){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Valores complementares (fora da base por produtos)';details.append(summary,group);card.append(details);}else card.append(group);
    }
    $('reader-products').append(card);
  });
}
function reviewedReaderItems(){
  if(!readerRows.length)throw new Error('Adicione pelo menos um produto.');
  return readerRows.map((row,index)=>{
    if(!String(row.description||'').trim()||!String(row.quantity??'').trim()||!String(row.price??'').trim())throw new Error(`Preencha descrição, quantidade e valor unitário do produto ${index+1}.`);
    const item={description:String(row.description).trim(),ncm:String(row.ncm||'').trim()};
    if(row.interstateRate!==undefined){item.interstateRate=Number(row.interstateRate);if(!Number.isFinite(item.interstateRate)||item.interstateRate<0||item.interstateRate>=100)throw new Error(`Confira a alíquota interestadual do produto ${index+1}.`);}
    if(item.ncm&&!/^\d{8}$/.test(item.ncm))throw new Error(`Confira o NCM do produto ${index+1}: use 8 dígitos ou deixe em branco.`);
    for(const key of ['quantity','price','freight','other','discount'])item[key]=parseNumber(row[key]);
    return item;
  });
}
function syncReaderCSV(){
  readerCSVInvalid=false;$('reader-reviewed').checked=false;
  try{$('reader-csv').value=itemsToCSV(reviewedReaderItems());}catch{}
  updateReaderButtons();
}
$('reader-add-product').onclick=()=>{readerRows.push({description:'',ncm:'',quantity:'',price:'',freight:0,other:0,discount:0});renderReaderRows();syncReaderCSV();$('reader-products').lastElementChild.querySelector('input').focus();};
$('reader-csv').oninput=()=>{
  $('reader-reviewed').checked=false;
  try{readerRows=parseCSV($('reader-csv').value);readerCSVInvalid=false;renderReaderRows();}catch{readerCSVInvalid=true;}
  updateReaderButtons();
};
$('reader-submit').onclick=async()=>{
  if(readerLoading||!readerAvailable)return;
  const file=$('reader-file').files[0]; if (!file) return;
  $('reader-error').textContent=''; clearPendingDocument(); const version=readerVersion;
  try {
    const mime={'pdf':'application/pdf','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp'}[file.name.split('.').pop().toLowerCase()];
    if (!mime || file.size>5*1024*1024) throw new Error('Escolha PDF, PNG, JPEG ou WebP de até 5 MB.');
    readerLoading=true; updateReaderButtons(); $('reader-submit').textContent='Lendo documento…'; $('reader-status').textContent='Carregando IA local. O documento permanece no seu dispositivo…';
    const progress=text=>{$('reader-status').textContent=text;};
    const parsed=await readDocument(file,progress);
    if (version!==readerVersion) return;
    if (!Array.isArray(parsed.items) || typeof parsed.text!=='string') throw new Error('O leitor não retornou um resultado válido.');
    calculate({items:parsed.items,origin:'SP',destination:'RJ',internalRate:18,interstate:12,fcp:0});
    pendingDocument={...parsed,name:file.name}; $('reader-review').hidden=false; $('reader-reviewed').checked=false;
    $('reader-result').textContent=parsed.blocked?'NFS-e de serviços identificada':`${parsed.items.length} produtos reconhecidos · IA no navegador`;
    renderRecognitionSummary(parsed);
    $('reader-text').textContent=parsed.text;
    $('reader-tables').textContent=JSON.stringify(parsed.tables||[],null,2);
    $('reader-table-details').hidden=!parsed.tables?.length;
    $('reader-warnings').textContent=(parsed.warnings || []).join(' ');
    $('reader-csv').value=itemsToCSV(parsed.items);
    readerRows=parsed.items.map(item=>({...item}));readerCSVInvalid=false;renderReaderRows();renderAutomaticProducts();
    $('reader-products-section').hidden=!!parsed.blocked;
    $('reader-products-help').textContent=parsed.verification?.complete?'Produtos preenchidos automaticamente. Confira os itens e os totais; não é necessário digitar as linhas.':'A identificação ficou incompleta ou os totais não conferem. Tente uma foto mais nítida, o PDF original ou o XML da NF-e. O site não continuará com valores parciais.';
    if(!parsed.items.length)$('reader-text').closest('details').open=true;
    $('reader-status').textContent=parsed.blocked?'Documento de serviço: não será importado no cálculo de DIFAL sobre mercadorias.':parsed.verification?.complete?'Reconhecimento concluído. Confira o resumo e continue para os dados da operação.':'Não foi possível concluir o reconhecimento com segurança. Nenhum produto do cálculo atual foi substituído.';
  } catch(error) { $('reader-error').textContent=error.name==='TimeoutError' ? 'Tempo de leitura excedido. Divida o documento ou use XML/CSV.' : error.message; $('reader-status').textContent='A leitura não foi concluída. Os itens do cálculo atual foram preservados.'; }
  finally { readerLoading=false; $('reader-submit').textContent='Reconhecer novamente'; updateReaderButtons(); }
};
$('reader-import').onclick=()=>{
  if(!pendingDocument||!pendingDocument.verification?.complete||pendingDocument.blocked||!$('reader-reviewed').checked||readerLoading)return;
  try {
    if(readerCSVInvalid)throw new Error('O CSV avançado contém erros. Corrija-o ou preencha os campos dos produtos.');
    for(const input of $('reader-products').querySelectorAll('input'))if(!input.reportValidity())return;
    const reviewed=reviewedReaderItems();
    calculate({items:reviewed,origin:'SP',destination:'RJ',internalRate:18,interstate:12,fcp:0});
    const expected=pendingDocument.verification.declaredProducts;
    if(expected!==null&&expected!==undefined&&Math.abs(productTotal(reviewed)-expected)>.021)throw new Error('Os valores revisados não conferem com o valor total dos produtos. Confira as alterações antes de importar.');
    if (reviewed.length>500) throw new Error('Limite de 500 itens por documento.');
    if (items.length && !window.confirm('Substituir os itens atuais pelos itens conferidos deste documento?')) return;
    items=reviewed;setInvoiceRates(pendingDocument); sourceName=pendingDocument.name+' (IA local conferida)';
    $('fcp-rate').value=0; $('eligible').checked=true; $('imported').checked=false;
    applyDocumentRoute(pendingDocument);
    suggestRate(); renderItems();
    $('file-name').textContent=pendingDocument.name; $('file-details').textContent=`${items.length} itens reconhecidos por IA · processamento local`; $('file-info').hidden=false;
    message('Produtos importados. Os estados identificados no documento já estão selecionados e podem ser alterados. Confira os dados da operação e as alíquotas antes de calcular.');
    $('origin').focus();
    $('reader-dialog').close(); $('reader-file').value=''; clearPendingDocument();
    $('origin').closest('.operation-card').scrollIntoView({behavior:'smooth',block:'center'});
  } catch(error) { $('reader-error').textContent=error.message; }
};

function renderRecognitionSummary(parsed){
  $('reader-summary').replaceChildren();
  const add=(label,value)=>{const line=document.createElement('div'),term=document.createElement('span'),amount=document.createElement('strong');term.textContent=label;amount.textContent=value;line.append(term,amount);$('reader-summary').append(line);};
  if(parsed.blocked){if(Number.isFinite(parsed.service?.amount))add('Valor do serviço',money(parsed.service.amount));add('Tipo do documento','NFS-e · ISSQN');return;}
  const v=parsed.verification||{};
  add('Produtos reconhecidos',String(parsed.items.length));
  add('Origem identificada',parsed.origin||'Não informada / ambígua');
  add('Destino identificado',parsed.destination||'Não informado / ambíguo');
  if(Number.isFinite(v.products))add('Total dos produtos',money(v.products));
  if(Number.isFinite(v.declaredTotal))add('Total da nota / orçamento (informativo)',money(v.declaredTotal));
  if(v.delivery)add('Entrega / frete (informativo)',money(v.delivery));
  const rates=[...new Set(parsed.items.map(item=>item.interstateRate).filter(Number.isFinite))];
  if(rates.length)add('ICMS informado na NF',rates.sort((a,b)=>a-b).map(rate=>rate+'%').join(' e ')+' por item');
  if(Number.isFinite(v.declaredProducts)&&v.declaredProducts!==v.products)add('Total de produtos declarado na nota',money(v.declaredProducts));
  if(Number.isFinite(v.base))add('Base do DIFAL · total dos produtos',money(v.base));
  add('Conferência',v.complete?(v.declaredProducts!==null?'Produtos conferem com o total declarado':'Linhas conferidas; sem total de produtos declarado'):'Leitura incompleta — não importar');
}
function renderAutomaticProducts(){
  $('reader-auto-body').replaceChildren();
  readerRows.forEach((item,index)=>{const row=document.createElement('tr');for(const value of [String(index+1),item.description,item.ncm||'—',String(item.quantity),money(Number(item.quantity)*Number(item.price)),item.interstateRate===undefined?'—':item.interstateRate+'%']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}$('reader-auto-body').append(row);});
}
