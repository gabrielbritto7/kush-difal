import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeDocument,fieldName,documentKind } from '../recognized-document.js';
import { calculate } from '../calculator.js';

const table={rows:[
  ['Código','Descrição','Marca','QTDE.','VLR. UNIT.','VLR. ST','TOTAL'],
  ['PRODUTO','PRODUTO','','','','',''],
  ['001','AB12','Parafuso de aço galvanizado','2,00','10,01','0,00','20,02'],
  ['002','ZX34','Arruela de aço','TIPO A 3,00','2,33','0,00','7,00'],
]};
const text='ORÇAMENTO\nCliente: Empresa Exemplo\nCidade: Cidade Exemplo - PR\nValor Total Produtos: 27,02\n(+)Taxa de Entrega: 4,98\n(-)Desconto: 0,00\n(=)Total Orçamento: 32,00';
test('structured AI cells recover shifted descriptions, overflow and rounded unit prices',()=>{
  const result=recognizeDocument([table],text);
  assert.equal(result.items.length,2);assert.equal(result.verification.complete,true);
  assert.match(result.items[0].description,/Parafuso/);assert.match(result.items[1].description,/TIPO A/);
  assert.equal(result.items[1].quantity,3);assert.equal(result.items[1].price,7/3);
  assert.equal(result.verification.products,27.02);assert.equal(result.verification.base,32);
  assert.equal(result.origin,null);assert.equal(result.destination,'PR');
  assert.equal(recognizeDocument([table],text.replace('Cidade Exemplo - PR','Cidade Exemplo PR')).destination,'PR');
  assert.equal(result.items.reduce((sum,item)=>Math.round((sum+item.freight)*100)/100,0),4.98);
  const calculated=calculate({items:result.items,origin:'SP',destination:'PR',internalRate:18,interstate:12,fcp:0});assert.equal(calculated.base,32);
});
test('common OCR heading errors are repaired without altering item digits',()=>{
  assert.equal(fieldName('GTDE.'),'quantity');assert.equal(fieldName('OQOTDE.'),'quantity');assert.equal(fieldName('Código'),'ignore');assert.equal(fieldName('Unidade'),'ignore');
  const input=structuredClone(table);input.rows[0][3]='GTDE.';assert.equal(recognizeDocument([input],text).verification.complete,true);
});
test('missing or inconsistent rows prevent an apparently complete extraction',()=>{
  const input=structuredClone(table);input.rows[2][6]='99,99';
  const result=recognizeDocument([input],text);assert.equal(result.verification.complete,false);assert.equal(result.verification.rejections.length,1);assert.equal(result.items.length,1);
  const unknown=recognizeDocument([{rows:[['CNPJ','Valor'],['1234','50,00']]}],text);assert.equal(unknown.items.length,0);assert.equal(unknown.verification.complete,false);
});
test('NFS-e is recognized as service, never transformed into a goods DIFAL base',()=>{
  const source='DANFSe v2.0\nDocumento Auxiliar da NFS-e\nDescrição do Serviço\nMANUTENÇÃO DE EQUIPAMENTO\nTRIBUTAÇÃO MUNICIPAL (ISSQN)\nVALOR TOTAL DA NFS-e VALOR DA OPERAÇÃO ! SERVIÇO Desconto\nR$ 1.000,00';
  const result=recognizeDocument([],source);assert.equal(result.blocked,true);assert.equal(result.items.length,0);assert.equal(result.service.amount,1000);assert.equal(result.service.description,'MANUTENÇÃO DE EQUIPAMENTO');
  assert.equal(documentKind('DANFE Documento auxiliar da NF-e'),'goods_invoice');
});
test('global discounts are allocated once and do not invent classification or origin',()=>{
  const result=recognizeDocument([table],text.replace('Desconto: 0,00','Desconto: 2,00').replace('Orçamento: 32,00','Orçamento: 30,00'));
  assert.equal(result.verification.base,30);assert.equal(result.verification.complete,true);assert.equal(result.items.every(item=>item.ncm===''),true);assert.equal(result.origin,null);
});
