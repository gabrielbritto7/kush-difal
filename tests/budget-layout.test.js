import test from 'node:test';
import assert from 'node:assert/strict';
import { readAlignedBudgetTables } from '../budget-layout.js';
import { recognizeDocument } from '../recognized-document.js';
import { wordsToLines } from '../table-model.js';

const word=(text,x0,y0,width=25)=>({text,x0,y0,x1:x0+width,y1:y0+12,confidence:90});
function budgetWords(){
  return [
    word('Código',10,20,38),word('Descrição',70,20,70),word('Marca',415,20,36),word('QTDE.',520,20,38),
    word('VLR.',575,20,27),word('UNIT.',610,20,32),word('VLR.',650,20,27),word('ST',680,20,15),word('TOTAL',720,20,40),
    word('PRODUTO',8,40,65),
    word('12345678',10,60,55),word('Componente Alfa',80,60,140),word('Exemplo',415,60,70),
    word('1,00',540,60),word('180,25',590,60,40),word('0,00',665,60),word('180,25',720,60,40),
    word('1002',10,80),word('Componente Beta',80,80,140),word('Exemplo',415,80,70),
    word('2,00',540,80),word('9,75',605,80),word('0,00',665,80),word('19,50',725,80,35),
    word('Valor Total Produtos:',520,110,160),word('199,75',720,110,40),
    word('Total Orçamento:',520,140,150),word('199,75',720,140,40),
  ];
}
function recognize(words){
  const text='ORÇAMENTO\nOrigem: SC\nDestino: PR\n'+wordsToLines(words).map(line=>line.text).join('\n');
  return recognizeDocument(readAlignedBudgetTables(words,780,550),text);
}
test('photo positions distinguish quantity, price, ST and total when neural cells merge headings',()=>{
  const result=recognize(budgetWords());
  assert.equal(result.verification.complete,true);assert.equal(result.items.length,2);
  assert.equal(result.items[0].quantity,1);assert.equal(result.items[0].price,180.25);
  assert.equal(result.items[1].quantity,2);assert.equal(result.items[1].price,9.75);
  assert.match(result.items[0].description,/Componente Alfa/);assert.match(result.items[0].description,/Exemplo/);
  assert.equal(result.verification.base,199.75);assert.equal(result.origin,'SC');assert.equal(result.destination,'PR');
  assert.equal(result.items[0].ncm,'','An eight-digit product code is not an explicit NCM');
});
test('wrapped descriptions are retained and summary values do not become products',()=>{
  const words=budgetWords();words.push(word('com acabamento especial',80,95,180));
  const result=recognize(words);
  assert.equal(result.verification.complete,true);assert.equal(result.items.length,2);
  assert.match(result.items[1].description,/com acabamento especial/);
});
test('illegible quantities and divergent totals stay blocked instead of being repaired from arithmetic',()=>{
  const words=budgetWords();words.find(word=>word.text==='2,00').text='Z,00';
  const result=recognize(words);
  assert.equal(result.verification.complete,false);assert.equal(result.verification.rejections.length,1);
  const other=budgetWords();other.find(word=>word.text==='19,50').text='29,50';
  assert.equal(recognize(other).verification.complete,false);
});
test('a photo without explicit, unambiguous table headings does not produce inferred columns',()=>{
  const words=budgetWords().filter(word=>word.text!=='QTDE.');
  assert.equal(readAlignedBudgetTables(words,780,550).length,0);
  const duplicate=budgetWords();duplicate.push(word('QTDE.',465,20,38));
  assert.equal(readAlignedBudgetTables(duplicate,780,550).length,0);
});
