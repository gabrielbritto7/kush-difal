import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceURL, aiStatus, readWithAI } from '../document-ai-client.js';
globalThis.location={origin:'https://difal.kush-archives.com.br'};

test('backend URL works with a bare hostname, subpath and existing API prefix',()=>{
  assert.equal(serviceURL('https://documents.example.com'),'https://documents.example.com/api/documents');
  assert.equal(serviceURL('https://documents.example.com/'),'https://documents.example.com/api/documents');
  assert.equal(serviceURL('https://documents.example.com/tools/'),'https://documents.example.com/tools/api/documents');
  assert.equal(serviceURL('https://documents.example.com/api/documents/'),'https://documents.example.com/api/documents');
  assert.equal(serviceURL(''),'https://difal.kush-archives.com.br/api/documents');
});
test('credentials, query strings and insecure remote URLs are rejected',()=>{
  for(const url of ['https://secret@example.com','https://user:secret@example.com','https://example.com?token=x','https://example.com#key','http://example.com','javascript:alert(1)']) assert.throws(()=>serviceURL(url));
  assert.equal(serviceURL('http://localhost:8000'),'http://localhost:8000/api/documents');
});
test('upload keeps the original binary and surfaces model failures without silent OCR fallback',async()=>{
  const previous=globalThis.fetch;let request;
  try {
    const file=new File(['%PDF-fixture'],'orcamento.pdf',{type:'application/pdf'});
    globalThis.fetch=async(url,options)=>{request={url,...options};return new Response(JSON.stringify({error:'Modelos não disponíveis'}),{status:503});};
    await assert.rejects(()=>readWithAI(file,'https://documents.example.com'),/Modelos não disponíveis/);
    assert.equal(request.body,file);assert.equal(request.headers['Content-Type'],'application/pdf');assert.equal(request.url,'https://documents.example.com/api/documents/extract');
  } finally {globalThis.fetch=previous;}
});
test('unexpected HTML or non-Docling output is not reported as successful AI',async()=>{
  const previous=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response('<html>404</html>',{status:404});
    await assert.rejects(()=>aiStatus('https://documents.example.com'),/não respondeu/);
    globalThis.fetch=async()=>new Response(JSON.stringify({items:[],text:'',method:'ocr'}));
    await assert.rejects(()=>readWithAI(new File(['x'],'photo.png'),'https://documents.example.com'),/Docling/);
  }finally{globalThis.fetch=previous;}
});
