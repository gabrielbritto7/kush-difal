import { readFile,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { STATES } from '../calculator.js';

export const SOURCE_URL='https://www.calculadoraicms.com.br/';
const cellText=value=>value.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();

export function extractReferenceRates(html){
  const table=[...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].find(match=>/\btabela-icms\b/.test(match[0]))?.[0];
  if(!table)throw new Error('A tabela de ICMS não foi encontrada. Confira o formato da fonte.');
  const rows=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match=>[...match[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map(cell=>({attributes:cell[1],text:cellText(cell[2])})));
  const header=rows.find(row=>row.length===28&&row.slice(1).every(cell=>STATES.includes(cell.text)));
  if(!header||new Set(header.slice(1).map(cell=>cell.text)).size!==27)throw new Error('As 27 UFs do cabeçalho precisam estar presentes, sem duplicação.');
  const rates={};
  for(const row of rows){
    const state=row[0]?.text;if(!STATES.includes(state))continue;
    const index=header.findIndex(cell=>cell.text===state),cell=row[index];
    if(row.length!==28||!cell||!/\bdiagonal\b/.test(cell.attributes)||rates[state]!==undefined)throw new Error('A diagonal da tabela está incompleta ou ambígua: '+state);
    const text=cell.text.replace(',','.');
    if(!/^\d{1,2}(?:\.\d{1,2})?$/.test(text)||Number(text)<=0||Number(text)>=100)throw new Error('Alíquota inválida na fonte: '+state);
    rates[state]=Number(text);
  }
  if(STATES.some(state=>rates[state]===undefined))throw new Error('Nenhuma alteração salva: faltam UFs na fonte.');
  const updated=html.match(/(?:[uú]ltima\s+atualiza[çc][aã]o)\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if(!updated)throw new Error('A data de atualização da fonte não foi encontrada.');
  return {source:SOURCE_URL,sourceUpdatedAt:`${updated[3]}-${updated[2]}-${updated[1]}`,rates:Object.fromEntries(STATES.map(state=>[state,rates[state]]))};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const argument=process.argv.indexOf('--file');
  let html;
  if(argument>=0){
    if(!process.argv[argument+1])throw new Error('Informe o arquivo HTML depois de --file.');
    html=await readFile(process.argv[argument+1],'utf8');
  }else{
    const response=await fetch(SOURCE_URL,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('A consulta à fonte falhou: HTTP '+response.status);
    html=await response.text();
  }
  const reference={...extractReferenceRates(html),retrievedAt:new Date().toISOString().slice(0,10)};
  const output=new URL('../icms-rates.js',import.meta.url);
  const content='// Alíquotas padrão transcritas da diagonal da fonte indicada. Não são regras por NCM.\n'+
    'export const ICMS_REFERENCE=Object.freeze('+JSON.stringify({...reference,rates:undefined},null,2)+');\n'+
    'export const INTERNAL_RATES=Object.freeze('+JSON.stringify(reference.rates,null,2)+');\n'+
    'export function destinationInternalRate(state){return Object.hasOwn(INTERNAL_RATES,state)?INTERNAL_RATES[state]:null;}\n';
  await writeFile(output,content);
  console.log(`Tabela atualizada: 27 UFs; atualização informada pela fonte: ${reference.sourceUpdatedAt}. Revise o diff antes de publicar.`);
}
