import { readDocument, readerStatus } from './browser-reader.js';
import { aiStatus, readWithAI, serviceURL } from './document-ai-client.js';
import { itemsToCSV } from './document-parser.js';
import { STATES, interstateRate, calculate, parseCSV, round } from './calculator.js';

const $ = id => document.getElementById(id);
const money = value => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const names = { AC:'Acre', AL:'Alagoas', AP:'Amapá', AM:'Amazonas', BA:'Bahia', CE:'Ceará', DF:'Distrito Federal', ES:'Espírito Santo', GO:'Goiás', MA:'Maranhão', MT:'Mato Grosso', MS:'Mato Grosso do Sul', MG:'Minas Gerais', PA:'Pará', PB:'Paraíba', PR:'Paraná', PE:'Pernambuco', PI:'Piauí', RJ:'Rio de Janeiro', RN:'Rio Grande do Norte', RS:'Rio Grande do Sul', RO:'Rondônia', RR:'Roraima', SC:'Santa Catarina', SP:'São Paulo', SE:'Sergipe', TO:'Tocantins' };
let items = [], result = null, editing = -1, sourceName = 'Inclusão manual';
let readerAvailable=false, readerLoading=false, pendingDocument=null, readerVersion=0, aiConfigLoaded=false, readerCheckVersion=0;
try { $('reader-service').value=localStorage.getItem('kush-document-ai-url') || ''; } catch {}
let history = [];
try { const saved = JSON.parse(localStorage.getItem('kush-history') || '[]'); if (Array.isArray(saved)) history = saved.filter(x => x && STATES.includes(x.origin) && STATES.includes(x.destination) && Number.isFinite(x.total) && Number.isFinite(x.base) && Number.isFinite(x.count) && Number.isFinite(new Date(x.date).getTime())).slice(0, 20); } catch {}
for (const id of ['origin','destination']) {
  $(id).add(new Option('Selecione a UF', ''));
  for (const uf of STATES) $(id).add(new Option(`${uf} — ${names[uf]}`, uf));
}
$('origin').value = 'SP'; $('destination').value = 'RJ';
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); $('message').hidden = !text; }
function settings() {
  if (!STATES.includes($('origin').value) || !STATES.includes($('destination').value)) throw new Error('Selecione os estados de origem e destino.');
  if (!$('internal-rate').value.trim()) throw new Error('Informe a alíquota interna do destino antes de calcular.');
  if (!$('interstate-rate').value.trim() || !$('fcp-rate').value.trim()) throw new Error('Preencha as alíquotas interestadual e FCP (use zero quando não aplicável).');
  if (!$('eligible').checked) throw new Error('Esta versão cobre consumidor final não contribuinte. Para outras operações, é necessária análise tributária específica.');
  return { origin: $('origin').value, destination: $('destination').value, internalRate: Number($('internal-rate').value), interstate: Number($('interstate-rate').value), fcp: Number($('fcp-rate').value), eligible: true };
}
function clearResult() {
  result = null; $('export-button').disabled = true;
  $('summary-origin').textContent = $('origin').value || '—'; $('summary-destination').textContent = $('destination').value || '—';
  $('summary-difal').textContent = money(0); $('summary-fcp').textContent = money(0);
  $('summary-total').textContent = money(0);
  $('difal-percent').textContent = '—'; $('fcp-percent').textContent = `${$('fcp-rate').value || 0}%`;
  $('summary-caption').textContent = items.length ? 'Confira as alíquotas e calcule para ver o resultado.' : 'Tudo o que você precisa, em um só lugar.';
  $('step-review').classList.toggle('current', items.length > 0); $('step-result').classList.remove('current');
  $('calculate-button').firstChild.textContent = 'Calcular DIFAL ';
}
function baseTotal() { return round(items.reduce((sum, i) => sum + round(i.quantity * i.price + i.freight + i.other - i.discount), 0)); }
function renderItems() {
  clearResult(); $('items-body').replaceChildren();
  $('items-empty').hidden = !!items.length; $('items-container').hidden = !items.length;
  $('item-count').textContent = `${items.length} ${items.length === 1 ? 'item' : 'itens'}`;
  $('base-total').textContent = $('summary-base').textContent = money(baseTotal());
  items.forEach((item, index) => {
    const row = document.createElement('tr');
    const description = document.createElement('td'), strong = document.createElement('strong'), small = document.createElement('small');
    strong.textContent = item.description; small.textContent = item.ncm ? `NCM ${item.ncm}` : 'NCM não informado'; description.append(strong, small); row.append(description);
    for (const value of [item.quantity.toLocaleString('pt-BR'), money(item.price), money(round(item.quantity * item.price + item.freight + item.other - item.discount))]) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
    const actions = document.createElement('td');
    for (const [text, title, action, cls] of [['✎','Editar item',() => openItem(index),''],['×','Remover item',() => { items.splice(index,1); renderItems(); },'remove']]) {
      const button = document.createElement('button'); button.textContent = text; button.title = title; button.setAttribute('aria-label', title + ' ' + item.description); button.className = 'row-button ' + cls; button.onclick = action; actions.append(button);
    }
    row.append(actions); $('items-body').append(row);
  });
}
function suggestRate() { $('interstate-rate').value = STATES.includes($('origin').value) && STATES.includes($('destination').value) ? interstateRate($('origin').value, $('destination').value, $('imported').checked) : ''; clearResult(); }
for (const id of ['origin','destination','imported']) $(id).addEventListener('change', suggestRate);
for (const id of ['internal-rate','interstate-rate','fcp-rate','eligible']) $(id).addEventListener('input', clearResult);
function openItem(index = -1) {
  editing = index; $('item-form').reset(); $('item-error').textContent = '';
  $('item-dialog-title').textContent = index < 0 ? 'Adicionar item' : 'Editar item';
  if (index >= 0) for (const [key,value] of Object.entries(items[index])) if ($('item-form').elements.namedItem(key)) $('item-form').elements.namedItem(key).value = value;
  $('item-dialog').showModal();
}
$('manual-button').onclick = () => openItem(); $('add-item').onclick = () => openItem();
$('item-form').onsubmit = event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
  const item = { ...data, description: data.description.trim() };
  for (const key of ['quantity','price','freight','other','discount']) item[key] = Number(data[key]);
  try {
    if (!item.description) throw new Error('Informe a descrição do produto.');
    calculate({ items: [item], origin:'SP',destination:'RJ',internalRate:18,interstate:12,fcp:0 });
    if (editing < 0) items.push(item); else items[editing] = item;
    renderItems(); $('item-dialog').close(); message('Item salvo. Confira os dados da operação antes de calcular.');
  } catch (error) { $('item-error').textContent = error.message; }
};
for (const button of document.querySelectorAll('.close-dialog')) button.onclick = () => button.closest('dialog').close();
for (const id of ['guide-button','learn-button']) $(id).onclick = () => $('guide-dialog').showModal();
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('template-button').onclick = () => download('\uFEFFdescricao;ncm;quantidade;valor_unitario;frete;outras_despesas;desconto\nProduto de exemplo;94036000;2;150,00;20,00;0;0\n','modelo-orcamento-kush.csv','text/csv;charset=utf-8');
for (const id of ['upload-button','sidebar-import']) $(id).onclick = () => $('file-input').click();
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
    return { description: value(product,'xProd') || 'Produto sem descrição', ncm: value(product,'NCM'), quantity, price, freight: number(product,'vFrete'), other: number(product,'vOutro') + number(product,'vSeg') + number(det,'vIPI'), discount: number(product,'vDesc') };
  });
  const rates = nodes(nf, 'ICMSUFDest');
  const uniform = tag => { const values = rates.map(rate => value(rate,tag)); return values.length === items.length && values.every(x => x !== '' && x === values[0]) ? Number(values[0]) : null; };
  return { items, origin, destination, internalRate:uniform('pICMSUFDest'), interstate:uniform('pICMSInter'), fcp:uniform('pFCPUFDest'), eligible:value(nf,'indFinal') === '1' && value(nf,'indIEDest') === '9', baseWarning, mixed: rates.length > 0 && uniform('pICMSUFDest') === null };
}
async function importFile(file) {
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('O arquivo excede 5 MB.');
    const extension = file.name.split('.').pop().toLowerCase();
    if (['pdf','png','jpg','jpeg','webp'].includes(extension)) {
      const transfer=new DataTransfer(); transfer.items.add(file); $('reader-file').files=transfer.files;
      clearPendingDocument(); await $('reader-button').onclick(); return;
    }
    if (!['xml','csv'].includes(extension)) throw new Error('Para PDF e imagens, use a opção “Ler PDF / foto”. Orçamentos XLSX devem ser exportados para CSV.');
    const text = await file.text(); const parsed = extension === 'xml' ? parseXML(text) : {items:parseCSV(text)};
    if (!parsed.items.length) throw new Error('Nenhum item encontrado no arquivo.');
    if (parsed.items.length > 2000) throw new Error('Limite de 2.000 itens por documento.');
    calculate({items:parsed.items,origin:parsed.origin || 'SP',destination:parsed.destination || 'RJ',internalRate:18,interstate:12,fcp:0});
    if (items.length && !window.confirm('Substituir os itens atuais pelos itens deste documento?')) return;
    // Replace document settings too, so rates from a previous invoice cannot leak into a new import.
    $('internal-rate').value = parsed.internalRate ?? ''; $('fcp-rate').value = parsed.fcp ?? 0;
    $('eligible').checked = parsed.eligible ?? true; $('imported').checked = parsed.interstate === 4;
    if (parsed.origin) $('origin').value = parsed.origin;
    if (parsed.destination) $('destination').value = parsed.destination;
    suggestRate();
    if (parsed.interstate !== null && parsed.interstate !== undefined) $('interstate-rate').value = parsed.interstate;
    items = parsed.items; sourceName = file.name; renderItems();
    $('file-name').textContent = file.name; $('file-details').textContent = `${items.length} itens · ${(file.size / 1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} KB · processamento local`; $('file-info').hidden = false;
    let notice = 'Documento importado. Confira os itens, o enquadramento e as alíquotas antes de calcular.';
    if (parsed.mixed) notice += ' Há alíquotas diferentes ou incompletas no XML: esta versão usa uma alíquota comum; separe os itens por enquadramento antes de calcular.';
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
    $('difal-percent').textContent = `${config.origin === config.destination ? 0 : round(config.internalRate - config.interstate)}%`; $('fcp-percent').textContent = `${config.fcp}%`;
    $('summary-caption').textContent = `Calculado com ${items.length} ${items.length === 1 ? 'item' : 'itens'} · base única`;
    $('export-button').disabled = false; $('step-result').classList.add('current');
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
  const lines = [['Kush — Simulação DIFAL por base única'],['Data',new Date(result.date).toLocaleString('pt-BR')],['Documento',result.sourceName],['Origem',result.origin,'Destino',result.destination],['ICMS interno (%)',result.internalRate,'ICMS interestadual (%)',result.interstate,'FCP (%)',result.fcp],[],['Descrição','NCM','Quantidade','Valor unitário','Frete','Outras despesas / IPI','Desconto','Base','DIFAL','FCP','Total']];
  const num = value => value.toLocaleString('pt-BR',{maximumFractionDigits:8,useGrouping:false});
  for (const row of result.rows) lines.push([row.description,row.ncm,...['quantity','price','freight','other','discount','base','difal','povertyFund','total'].map(key=>num(row[key]))]);
  lines.push([],['Base total',num(result.base)],['DIFAL total',num(result.difal)],['FCP total',num(result.povertyFund)],['Total estimado',num(result.total)],[],['Estimativa: confirme legislação, enquadramento, NCM e componentes da base antes de recolher. Não contempla ICMS-ST, benefícios fiscais ou base dupla.']);
  download('\uFEFF' + lines.map(row => row.map(cell).join(';')).join('\r\n'),`difal-${result.origin}-${result.destination}-${result.date.slice(0,10)}.csv`,'text/csv;charset=utf-8');
};
$('new-button').onclick = () => {
  if (items.length && !window.confirm('Limpar os dados e iniciar um novo cálculo?')) return;
  items=[]; sourceName='Inclusão manual'; $('origin').value='SP'; $('destination').value='RJ'; $('internal-rate').value=''; $('interstate-rate').value=12; $('fcp-rate').value=0; $('imported').checked=false; $('eligible').checked=true; $('file-info').hidden=true; message(''); renderItems();
};
$('history-count').textContent = history.length;
renderItems();

function usesAI(){return $('reader-mode').value==='ai';}
function updateConsent(){
  const ai=usesAI();let destination='o serviço de IA configurado';
  try {destination=new URL(serviceURL($('reader-service').value)).origin;}catch{}
  $('reader-consent-label').textContent=ai ? `Autorizo enviar este documento para ${destination}, onde o Docling analisará as tabelas. Vou conferir o resultado antes de calcular.` : 'Quero processar este arquivo no meu navegador e conferir os itens reconhecidos. O documento não será enviado ao servidor.';
  $('reader-privacy').textContent=ai ? 'No modo IA, o documento é enviado ao serviço escolhido. O backend deste projeto usa arquivos temporários e os exclui ao finalizar. Não envie documentos a endereços que você não reconhece.' : 'No modo local, o documento fica no seu dispositivo. As ferramentas são baixadas deste site e só resumos de cálculos são salvos no navegador.';
}
async function checkReader(){
  readerAvailable=false;updateReaderButtons();updateConsent();const version=++readerCheckVersion;
  $('reader-status').textContent=usesAI()?'Verificando o serviço de IA…':'Verificando o leitor local…';
  try {
    if(!aiConfigLoaded){
      aiConfigLoaded=true;
      try {const response=await fetch('/app-config.json');if(response.ok){const config=await response.json();if(!$('reader-service').value && config.documentAIUrl)$('reader-service').value=config.documentAIUrl;}}catch{}
      updateConsent();
    }
    const ai=usesAI();const status=ai?await aiStatus($('reader-service').value):readerStatus();
    if(version!==readerCheckVersion)return;
    readerAvailable=status.enabled===true;
    $('reader-status').textContent=ai ? (readerAvailable ? (status.ready?'IA Docling disponível. As tabelas serão analisadas no serviço informado.':'Serviço Docling conectado. Os modelos serão carregados na primeira leitura; o servidor precisa ter acesso aos pesos oficiais.') : 'O serviço respondeu, mas o Docling não está instalado. Confira a instalação do backend.') : (readerAvailable?'Leitor local disponível. Reconhece tabelas simples, sem enviar o arquivo.':'Seu navegador não oferece suporte ao leitor local. Use um navegador atualizado ou o serviço de IA.');
  }catch(error){
    if(version!==readerCheckVersion)return;
    readerAvailable=false;
    $('reader-status').textContent=usesAI()?'A IA ainda não está conectada. Abra “Conectar serviço de IA” e informe o endereço do backend Docling. Publicar apenas o frontend na Vercel não ativa a IA.':'Não foi possível ativar o leitor local.';
  }
  updateReaderButtons();
}
$('reader-button').onclick=async()=>{ $('reader-dialog').showModal();$('reader-error').textContent='';await checkReader(); };
$('reader-mode').onchange=async()=>{clearPendingDocument();$('reader-consent').checked=false;await checkReader();};
$('reader-service-connect').onclick=async()=>{
  $('reader-error').textContent='';
  try {const url=serviceURL($('reader-service').value);$('reader-service').value=url;try{localStorage.setItem('kush-document-ai-url',url);}catch{}clearPendingDocument();$('reader-consent').checked=false;await checkReader();}catch(error){$('reader-error').textContent=error.message;readerAvailable=false;updateReaderButtons();}
};
$('reader-service').oninput=()=>{readerCheckVersion++;clearPendingDocument();$('reader-consent').checked=false;readerAvailable=false;updateConsent();updateReaderButtons();};
function updateReaderButtons() {
  $('reader-submit').disabled=!readerAvailable || readerLoading || !$('reader-consent').checked || !$('reader-file').files.length;
  $('reader-import').disabled=readerLoading || !pendingDocument || !$('reader-reviewed').checked;
  $('reader-file').disabled=readerLoading;
  $('reader-consent').disabled=readerLoading;
  $('reader-mode').disabled=readerLoading;$('reader-service').disabled=readerLoading;$('reader-service-connect').disabled=readerLoading;
}
function clearPendingDocument() { readerVersion++; pendingDocument=null; $('reader-review').hidden=true; $('reader-reviewed').checked=false; updateReaderButtons(); }
$('reader-file').onchange=clearPendingDocument;
$('reader-consent').onchange=updateReaderButtons;
$('reader-reviewed').onchange=updateReaderButtons;
$('reader-csv').oninput=()=>{ $('reader-reviewed').checked=false; updateReaderButtons(); };
$('reader-submit').onclick=async()=>{
  if (readerLoading || !readerAvailable || !$('reader-consent').checked) return;
  const file=$('reader-file').files[0]; if (!file) return;
  $('reader-error').textContent=''; clearPendingDocument(); const version=readerVersion;
  try {
    const mime={'pdf':'application/pdf','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp'}[file.name.split('.').pop().toLowerCase()];
    if (!mime || file.size>5*1024*1024) throw new Error('Escolha PDF, PNG, JPEG ou WebP de até 5 MB.');
    readerLoading=true; updateReaderButtons(); $('reader-submit').textContent='Lendo documento…'; $('reader-status').textContent=usesAI()?'Enviando o documento ao serviço de IA para analisar tabelas…':'Processando no seu navegador. Um PDF digitalizado pode levar alguns minutos.';
    const progress=text=>{$('reader-status').textContent=text;};
    const parsed=usesAI()?await readWithAI(file,$('reader-service').value,progress):await readDocument(file,progress);
    if (version!==readerVersion) return;
    if (!Array.isArray(parsed.items) || typeof parsed.text!=='string') throw new Error('O leitor não retornou um resultado válido.');
    calculate({items:parsed.items,origin:'SP',destination:'RJ',internalRate:18,interstate:12,fcp:0});
    pendingDocument={...parsed,name:file.name}; $('reader-review').hidden=false; $('reader-reviewed').checked=false;
    $('reader-result').textContent=`${parsed.items.length} itens sugeridos · ${parsed.method==='docling'?`IA Docling · ${parsed.tableCount} tabelas`:parsed.method==='pdf-text'?'leitura direta de PDF':'reconhecimento OCR'}`;
    $('reader-text').textContent=parsed.text;
    $('reader-tables').textContent=parsed.method==='docling'?JSON.stringify(parsed.tables || [],null,2):'';
    $('reader-table-details').hidden=parsed.method!=='docling';
    $('reader-warnings').textContent=(parsed.warnings || []).join(' ');
    $('reader-csv').value=itemsToCSV(parsed.items);
    $('reader-status').textContent='Leitura concluída. Confira o texto extraído e ajuste os itens antes de importar.';
  } catch(error) { $('reader-error').textContent=error.name==='TimeoutError' ? 'Tempo de leitura excedido. Divida o documento ou use XML/CSV.' : error.message; $('reader-status').textContent='A leitura não foi concluída. Os itens do cálculo atual foram preservados.'; }
  finally { readerLoading=false; $('reader-submit').textContent='Extrair texto e itens'; updateReaderButtons(); }
};
$('reader-import').onclick=()=>{
  if (!pendingDocument || !$('reader-reviewed').checked || readerLoading) return;
  try {
    const reviewed=parseCSV($('reader-csv').value);
    calculate({items:reviewed,origin:'SP',destination:'RJ',internalRate:18,interstate:12,fcp:0});
    if (reviewed.length>500) throw new Error('Limite de 500 itens por documento.');
    if (items.length && !window.confirm('Substituir os itens atuais pelos itens conferidos deste documento?')) return;
    items=reviewed; sourceName=pendingDocument.name+(pendingDocument.method==='docling'?' (IA Docling conferida)':' (leitura no navegador conferida)');
    $('internal-rate').value=''; $('fcp-rate').value=0; $('eligible').checked=false; $('imported').checked=false;
    $('origin').value=STATES.includes(pendingDocument.origin)?pendingDocument.origin:'';
    $('destination').value=STATES.includes(pendingDocument.destination)?pendingDocument.destination:'';
    suggestRate(); renderItems();
    $('file-name').textContent=pendingDocument.name; $('file-details').textContent=`${items.length} itens conferidos · ${pendingDocument.method==='docling'?'IA Docling':'leitura no navegador'}`; $('file-info').hidden=false;
    message('Itens importados após conferência. Complete as UFs, as alíquotas, os componentes da base e o enquadramento fiscal antes de calcular.');
    $('reader-dialog').close(); $('reader-file').value=''; $('reader-consent').checked=false; clearPendingDocument();
    $('items-container').scrollIntoView({behavior:'smooth',block:'center'});
  } catch(error) { $('reader-error').textContent=error.message; }
};
