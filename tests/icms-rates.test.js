import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES } from '../calculator.js';
import { destinationInternalRate,INTERNAL_RATES,ICMS_REFERENCE } from '../icms-rates.js';
import { extractReferenceRates } from '../scripts/update-icms-rates.mjs';

function sourceTable(){
  const header='<tr><th></th>'+STATES.map(state=>`<th>${state}</th>`).join('')+'</tr>';
  const rows=STATES.map((state,index)=>'<tr><td>'+state+'</td>'+STATES.map((_,column)=>`<td${index===column?' class="diagonal"':''}>${index===column?(index===0?'19,5':'18'):'12'}</td>`).join('')+'</tr>').join('');
  return 'Última atualização 19/08/2026<table class="tabela-icms">'+header+rows+'</table>';
}
test('reference parser uses the state diagonal, not a neighboring interstate cell',()=>{
  const result=extractReferenceRates(sourceTable());
  assert.equal(result.rates.AC,19.5);assert.equal(result.rates.TO,18);assert.equal(result.sourceUpdatedAt,'2026-08-19');
});
test('a missing or malformed source never silently becomes a partial rate table',()=>{
  assert.throws(()=>extractReferenceRates(sourceTable().replace('<td class="diagonal">19,5</td>','<td>19,5</td>')),/diagonal/);
  assert.throws(()=>extractReferenceRates(sourceTable().replace('<th>TO</th>','<th>SP</th>')),/27 UFs/);
  assert.throws(()=>extractReferenceRates(sourceTable().replace('<td class="diagonal">19,5</td>','<td class="diagonal">-1</td>')),/inválida/);
  assert.throws(()=>extractReferenceRates(sourceTable().replace('Última atualização 19/08/2026','')),/data/);
});
test('the deployed reference covers every UF, has provenance and does not guess missing states',()=>{
  assert.deepEqual(Object.keys(INTERNAL_RATES).sort(),[...STATES].sort());
  assert.equal(destinationInternalRate('PR'),19.5);assert.equal(destinationInternalRate(''),null);assert.equal(destinationInternalRate('XX'),null);assert.equal(destinationInternalRate('constructor'),null);
  assert.equal(ICMS_REFERENCE.source,'https://www.calculadoraicms.com.br/');assert.match(ICMS_REFERENCE.sourceUpdatedAt,/^\d{4}-\d{2}-\d{2}$/);
});
