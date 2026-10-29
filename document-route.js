import { STATES } from './calculator.js';

const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const stateNames={acre:'AC',alagoas:'AL',amapa:'AP',amazonas:'AM',bahia:'BA',ceara:'CE','distrito federal':'DF','espirito santo':'ES',goias:'GO',maranhao:'MA','mato grosso':'MT','mato grosso do sul':'MS','minas gerais':'MG',para:'PA',paraiba:'PB',parana:'PR',pernambuco:'PE',piaui:'PI','rio de janeiro':'RJ','rio grande do norte':'RN','rio grande do sul':'RS',rondonia:'RO',roraima:'RR','santa catarina':'SC','sao paulo':'SP',sergipe:'SE',tocantins:'TO'};
const statesPattern=STATES.join('|');
const namesPattern=Object.keys(stateNames).sort((a,b)=>b.length-a.length).join('|');
const stateValue=`(?:${namesPattern}|${statesPattern.toLowerCase()})`;
const destinationHeading=/^(?:dados (?:do|da) )?(?:destinatario|cliente|tomador|adquirente)\b/;
const originHeading=/^(?:(?:identificacao|dados) (?:do|da) )?(?:emitente|remetente|fornecedor|prestador)\b/;
const sectionEnd=/\b(?:dados (?:dos? )?produtos|calculo do imposto|transportador|fatura|duplicatas|informacoes complementares|servico prestado|tributacao|forma (?:de )?pagamento)\b|(?:descricao|produto).*(?:qtde|qtd\b|quantidade|vlr|unitario)/;
const addressCue=/\b(?:endereco|cidade|municipio|cep|rua|avenida|av\.?|rodovia|bairro)\b/;

function stateFrom(value){const clean=normalize(value).trim();return stateNames[clean]|| (STATES.includes(clean.toUpperCase())?clean.toUpperCase():null);}

function addressStates(lines){
  const values=new Set();
  for(let index=0;index<lines.length;index++){
    const line=lines[index],normal=normalize(line);
    for(const match of normal.matchAll(new RegExp(`\\b(?:uf|estado)(?:\\s+(?:do|da)\\s+(?:emitente|fornecedor|cliente|destinatario))?\\s*[:=\\-]\\s*(${stateValue})\\b`,'g')))values.add(stateFrom(match[1]));
    // City / UF and City - UF are common in addresses. Product codes never reach this function.
    for(const match of line.matchAll(/\b([\p{L}][\p{L} .']{2,60})\s*[-/]\s*([A-Z]{2})\b/gu)){
      if(!/\b(?:nfs|nf|e|fax|versao)$/i.test(match[1].trim())&&STATES.includes(match[2]))values.add(match[2]);
    }
    const city=normal.match(new RegExp(`\\b(?:cidade|municipio)\\s*[:=]\\s*[^\\n]*?\\s+(${statesPattern.toLowerCase()})\\s*(?:$|\\bcep\\b|\\d{5})`));
    if(city)values.add(city[1].toUpperCase());
    const previous=normalize(lines[index-1]||'');
    if(addressCue.test(normal)||/\buf\b/.test(previous)){
      for(const match of line.matchAll(new RegExp(`\\b(${statesPattern})\\b`,'g')))values.add(match[1]);
    }
    // A vertically printed UF label can have its value on the following line.
    if(/^\s*(?:uf|estado)\s*:?[\s]*$/.test(previous)){
      const state=stateFrom(line);if(state)values.add(state);
    }
  }
  return [...values].filter(Boolean);
}

export function extractDocumentRoute(text){
  const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()),evidence={origin:[],destination:[]};
  const add=(role,state,source)=>{if(state)evidence[role].push({state,source});};
  // Direct route labels take no information from a filename, telephone, CNPJ or previous import.
  for(const line of lines){
    for(const [role,label,parties]of [['origin','origem','emitente|remetente|fornecedor'],['destination','destino','destinatario|cliente|tomador']]){
      const pattern=new RegExp(`\\b(?:(?:(?:estado|uf)\\s+(?:de\\s+)?)?${label}|(?:estado|uf)\\s+(?:(?:do|da)\\s+)?(?:${parties}))\\s*[:=\\-]\\s*(${stateValue})\\b`,'g');
      for(const match of normalize(line).matchAll(pattern))add(role,stateFrom(match[1]),`UF de ${label} declarada`);
    }
  }
  const blocks=[];let current=null,firstHeading=lines.length;
  for(const [index,line]of lines.entries()){
    const normal=normalize(line);
    if(sectionEnd.test(normal)||/nao identificado/.test(normal)){current=null;continue;}
    const role=destinationHeading.test(normal)?'destination':originHeading.test(normal)?'origin':null;
    if(role){firstHeading=Math.min(firstHeading,index);current={role,lines:[]};blocks.push(current);}
    if(current)current.lines.push(line);
  }
  for(const block of blocks)for(const state of addressStates(block.lines))add(block.role,state,block.role==='origin'?'Endereço do emitente / fornecedor':'Endereço do destinatário / cliente');
  // In a budget, a company address before the client block belongs to the supplier.
  // Require an actual address and CNPJ; an unlabelled state elsewhere is insufficient.
  const prefix=lines.slice(0,firstHeading);
  if(/\b(?:orcamento|cotacao|proposta)\b/.test(normalize(text))&&prefix.some(line=>/\bcnpj\b/.test(normalize(line)))&&prefix.some(line=>addressCue.test(normalize(line)))){
    for(const state of addressStates(prefix))add('origin',state,'Endereço do fornecedor no cabeçalho');
  }
  const result={origin:null,destination:null,routeSources:{origin:null,destination:null},routeWarnings:[]};
  for(const role of ['origin','destination']){
    const values=[...new Set(evidence[role].map(item=>item.state))];
    if(values.length===1){result[role]=values[0];result.routeSources[role]=evidence[role][0].source;}
    if(values.length>1)result.routeWarnings.push(`Há UFs diferentes para ${role==='origin'?'a origem':'o destino'} no documento. Selecione o estado correto nos dados da operação.`);
  }
  return result;
}
