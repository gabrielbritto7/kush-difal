import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeDocument,fieldName,documentKind,readDocumentAmounts } from '../recognized-document.js';
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
  assert.equal(result.verification.products,27.02);assert.equal(result.verification.base,27.02);assert.equal(result.verification.declaredTotal,32);
  assert.equal(result.origin,null);assert.equal(result.destination,'PR');
  assert.equal(recognizeDocument([table],text.replace('Cidade Exemplo - PR','Cidade Exemplo PR')).destination,'PR');
  assert.equal(result.verification.delivery,4.98);assert.equal(result.items.reduce((sum,item)=>Math.round((sum+item.freight)*100)/100,0),0);
  const calculated=calculate({items:result.items,origin:'SP',destination:'PR',internalRate:18,interstate:12,fcp:0});assert.equal(calculated.base,27.02);
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
test('global discounts do not alter the products base or invent classification or origin',()=>{
  const result=recognizeDocument([table],text.replace('Desconto: 0,00','Desconto: 2,00').replace('Orçamento: 32,00','Orçamento: 30,00'));
  assert.equal(result.verification.base,27.02);assert.equal(result.verification.complete,true);assert.equal(result.items.every(item=>item.ncm===''),true);assert.equal(result.origin,null);
});
test('invoice row totals define the products base; invoice charges and grand total are informational',()=>{
  const table={rows:[['Descrição','NCM','QTD / UN','VLR UNIT','VLR TOTAL','VALOR IPI','VALOR DESC','ALÍQ ICMS'],['Peça Alfa','12345678','1,0000 UN','100,0000','100,00','10,00','5,00','4,00']]};
  const result=recognizeDocument([table],'DANFE\nOrigem: SP\nDestino: PR',{declaredProducts:100,declaredTotal:122,delivery:15,insurance:2,ipi:10,discount:5,other:0});
  assert.equal(result.verification.complete,true);assert.equal(result.verification.base,100);assert.equal(result.verification.declaredTotal,122);assert.equal(result.items[0].price,100);assert.equal(result.items[0].other,10);assert.equal(result.items[0].interstateRate,4);
  const incomplete=recognizeDocument([table],'DANFE\nOrigem: SP\nDestino: PR',{declaredProducts:200,declaredTotal:222});assert.equal(incomplete.verification.complete,false);
});
test('explicit NCM tags can be read from newer invoice descriptions without guessing a classification',()=>{
  const result=recognizeDocument([{rows:[['Descrição','QTD / UN','VLR UNIT','VLR TOTAL'],['Peça Exemplo [NCM 12345678]','2 UN','50,00','100,00']]}],'DANFE',{declaredProducts:100,declaredTotal:100});
  assert.equal(result.items[0].ncm,'12345678');assert.equal(result.verification.complete,true);
});
test('OCR table-border glyphs are removed without repairing or inventing digits',()=>{
  const table={rows:[['Descrição','Qtd','Valor Unit','Total'],['Componente Exemplo','[2,00','50,00|','100,00']]};
  assert.equal(recognizeDocument([table],'DANFE',{declaredProducts:100,declaredTotal:100}).verification.complete,true);
  table.rows[1][1]='[Z,00';assert.equal(recognizeDocument([table],'DANFE',{declaredProducts:100,declaredTotal:100}).verification.complete,false);
});
test('a second OCR reading must preserve the products constraint while other totals remain informational',()=>{
  const amounts=readDocumentAmounts(text);
  assert.equal(amounts.delivery,4.98);assert.equal(amounts.discount,0);assert.equal(amounts.declaredTotal,32);
  assert.deepEqual(readDocumentAmounts('Orçamento sem totais legíveis'),{declaredProducts:null,delivery:null,discount:null,declaredTotal:null});
  const second='ORÇAMENTO\nCliente: Empresa Exemplo';
  const result=recognizeDocument([table],second,amounts);
  assert.equal(result.verification.complete,true);assert.equal(result.verification.base,27.02);assert.equal(result.verification.declaredTotal,32);
  assert.equal(recognizeDocument([table],second,{...amounts,declaredTotal:33}).verification.complete,true);
  assert.equal(recognizeDocument([table],second,{...amounts,conflicts:['declaredTotal','delivery']}).verification.complete,true);
  assert.equal(recognizeDocument([table],second,{...amounts,declaredProducts:33}).verification.complete,false);
  assert.equal(recognizeDocument([table],second,{...amounts,conflicts:['declaredProducts']}).verification.complete,false);
});
test('a small invoice-only charge does not block products or increase the DIFAL base',()=>{
  const rows=[['Descrição','Qtd','VLR UNIT','TOTAL'],['Componente Alfa','2,00','100,00','200,00']];
  const result=recognizeDocument([{rows}],'DANFE\nOrigem: SP\nDestino: PR',{declaredProducts:200,declaredTotal:200.05});
  assert.equal(result.verification.complete,true);assert.equal(result.verification.base,200);assert.equal(result.verification.declaredTotal,200.05);
  assert.equal(calculate({items:result.items,origin:'SP',destination:'PR',internalRate:19.5,interstate:12,fcp:0}).difal,15);
  assert.equal(recognizeDocument([{rows}],'DANFE',{declaredProducts:300,declaredTotal:300.05}).verification.complete,false);
});
test('a shared ICMS/IPI rate heading preserves the explicit ICMS rate in its printed order',()=>{
  const rows=[['Descrição','Qtd','VLR UNIT','TOTAL','ALÍQUOTAS ICMS IPI'],['Componente Alfa','1,00','100,00','100,00','4,00 5,00']];
  const result=recognizeDocument([{rows}],'DANFE\nOrigem: SP\nDestino: PR',{declaredProducts:100,declaredTotal:105});
  assert.equal(result.verification.complete,true);assert.equal(result.items[0].interstateRate,4);assert.equal(result.verification.base,100);
});
