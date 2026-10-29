import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDocumentRoute } from '../document-route.js';
import { recognizeDocument } from '../recognized-document.js';

test('reads explicit routes including state names and inline labels',()=>{
  const route=extractDocumentRoute('Origem: Santa Catarina | Destino: Paraná');
  assert.equal(route.origin,'SC');assert.equal(route.destination,'PR');
  assert.equal(extractDocumentRoute('UF do emitente: MG\nEstado do destinatário: BA').destination,'BA');
});
test('assigns budget supplier and client addresses to the correct roles',()=>{
  const route=extractDocumentRoute('CNPJ: 00.000.000/0000-00\nRua Exemplo, 100\nJoinville - SC\nORÇAMENTO 99\nCliente: Empresa Exemplo\nCidade: Londrina PR\nDescrição Qtd Valor unitário Total\nPeça MS - SP 1 10,00 10,00');
  assert.equal(route.origin,'SC');assert.equal(route.destination,'PR');
  assert.match(route.routeSources.origin,/cabeçalho/);
});
test('reads DANFE party sections and a separately printed UF column',()=>{
  const route=extractDocumentRoute('IDENTIFICAÇÃO DO EMITENTE\nEmpresa Exemplo\nAv. Exemplo, 100 - Campinas - SP\nDESTINATÁRIO / REMETENTE\nNome Empresa Cliente\nMUNICÍPIO FONE/FAX UF INSCRIÇÃO ESTADUAL\nSalvador 7133334444 BA 123456\nCÁLCULO DO IMPOSTO\nTRANSPORTADOR\nRua Exemplo - Curitiba - PR');
  assert.equal(route.origin,'SP');assert.equal(route.destination,'BA');
});
test('vertical UF values work in either section order',()=>{
  const route=extractDocumentRoute('DADOS DO CLIENTE\nUF\nRJ\nFORNECEDOR\nEstado:\nMinas Gerais');
  assert.equal(route.origin,'MG');assert.equal(route.destination,'RJ');
});
test('ambiguous states remain unselected instead of silently choosing one',()=>{
  const route=extractDocumentRoute('Origem: SP\nFORNECEDOR\nCidade: Curitiba - PR\nCLIENTE\nCidade: Salvador - BA');
  assert.equal(route.origin,null);assert.equal(route.destination,'BA');assert.equal(route.routeWarnings.length,1);
});
test('does not infer states from phone, CNPJ, municipality alone or product codes',()=>{
  const route=extractDocumentRoute('ORÇAMENTO SC.9999\nCNPJ: 00.000.000/0000-00\nRua Exemplo, 100\nTelefone: (47) 3333-4444\nCliente: Empresa Exemplo\nCidade: São Paulo\nDescrição Qtd Valor unitário Total\nKIT MS - SP 1 10,00 10,00');
  assert.equal(route.origin,null);assert.equal(route.destination,null);
});
test('NFS-e party states remain informational while goods import stays blocked',()=>{
  const result=recognizeDocument([],'DANFSe\nPRESTADOR / FORNECEDOR\nMunicípio / Sigla UF\nCuritiba / PR\nTOMADOR / ADQUIRENTE\nMunicípio / Sigla UF\nSão Paulo / SP\nSERVIÇO PRESTADO\nCuritiba / PR');
  assert.equal(result.origin,'PR');assert.equal(result.destination,'SP');assert.equal(result.blocked,true);assert.equal(result.items.length,0);
});
