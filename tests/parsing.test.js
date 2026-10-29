import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentText, itemsToCSV } from '../document-parser.js';

import { parseCSV } from '../calculator.js';

const text='ORCAMENTO\nOrigem: SP\nDestino: RJ\nDescricao  NCM  Qtd  Valor unitario  Total\nMesa de madeira  94036000  2  150,00  300,00\nCadeira  94036000  3  100,00  300,00\nTotal: 600,00';
test('parses explicit table, declared UFs and checks row totals',()=>{
  const result=parseDocumentText(text); assert.equal(result.items.length,2); assert.equal(result.origin,'SP'); assert.equal(result.destination,'RJ'); assert.equal(result.items[0].price,150); assert.equal(result.items[1].quantity,3);
});
test('compact OCR tables retain descriptions and NCM without inventing fields',()=>{
  const result=parseDocumentText('Descricao NCM Qtd UN Valor unitario Total\nMesa de madeira 94036000 2 UN 150,00 300,00');
  assert.equal(result.items.length,1); assert.equal(result.items[0].ncm,'94036000'); assert.equal(result.origin,null);
});
test('rejects inconsistent totals and ignores unknown layouts instead of guessing',()=>{
  assert.equal(parseDocumentText(text.replace('150,00  300,00','150,00  390,00')).items.length,1);
  const result=parseDocumentText('NF-e 123\nCNPJ 12.345.678/0001-00\nBase ICMS 1000,00\nProduto desconhecido 2 150,00 300,00'); assert.equal(result.items.length,0); assert.match(result.warnings.join(' '),/Não reconhecemos/);
});
test('editable CSV roundtrip, decimals and escaped product names',()=>{
  const item={description:'Mesa; "clara"',ncm:'',quantity:2.5,price:150,freight:10,other:0,discount:0}; assert.deepEqual(parseCSV(itemsToCSV([item])),[item]);
});
test('advanced CSV roundtrip preserves invoice rates per item',()=>{
  const items=[{description:'Peça Exemplo',ncm:'',quantity:1,price:100,freight:0,other:0,discount:0,interstateRate:4}];
  assert.deepEqual(parseCSV(itemsToCSV(items)),items);
});

test('common invoice headings and extra fiscal columns preserve product fields',()=>{
  const result=parseDocumentText('Codigo  Descricao do produto / servico  NCM  CFOP  UN  QTD  Vr. Unit. (R$)  Total\n123  Mesa industrial  94036000  6102  UN  2  150,00  300,00');
  assert.equal(result.items.length,1);assert.equal(result.items[0].description,'Mesa industrial');assert.equal(result.items[0].price,150);
});
