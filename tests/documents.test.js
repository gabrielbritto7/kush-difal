import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocumentText, itemsToCSV } from '../document-parser.js';
import { readDocument, readerStatus, validateFile } from '../document-reader.mjs';
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
test('reject unsupported, mislabeled, empty and excessive files',()=>{
  assert.throws(()=>validateFile({data:'',mime:'application/pdf'})); assert.throws(()=>validateFile({data:Buffer.from('hello').toString('base64'),mime:'application/pdf'}),/conteúdo/); assert.throws(()=>validateFile({data:'A'.repeat(8*1024*1024),mime:'application/pdf'})); assert.throws(()=>validateFile({data:'abcd',mime:'text/html'}));
});

// Generate a real text PDF without a PDF dependency; preserve spaces with Courier.
export function makePDF(lines) {
  const stream='BT /F1 12 Tf 40 760 Td 20 TL '+lines.map((line,i)=>(i?'T* ':'')+'('+line.replace(/[\\()]/g,'\\$&')+') Tj').join('\n')+' ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n'; const offsets=[0]; for (let i=0;i<objects.length;i++) {offsets.push(Buffer.byteLength(pdf)); pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const start=Buffer.byteLength(pdf); pdf+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`; return Buffer.from(pdf);
}
test('real Poppler extraction recognizes PDF table without network or credentials',async()=>{
  assert.equal((await readerStatus()).enabled,true);
  const bytes=makePDF(text.split('\n')); const result=await readDocument({mime:'application/pdf',data:bytes.toString('base64')}); assert.equal(result.method,'pdf-text'); assert.equal(result.items.length,2); assert.equal(result.items[0].description,'Mesa de madeira'); assert.equal(result.items[0].quantity,2); assert.equal(result.items[0].price,150); assert.equal(result.pages,1);
});
test('real Tesseract OCR reads a generated image and returns reviewable products',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'kush-test-'));
  try {
    const path=join(dir,'budget.png');
    await exec('python3',['-c',`from PIL import Image, ImageDraw, ImageFont
import sys
im=Image.new('RGB',(2100,600),'white'); draw=ImageDraw.Draw(im); font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',38)
lines=['ORCAMENTO','Origem: SP','Destino: RJ','Descricao Qtd Valor unitario Total','Mesa de madeira 2 150,00 300,00','Cadeira 3 100,00 300,00']
for i,line in enumerate(lines): draw.text((50,40+i*78),line,fill='black',font=font)
im.save(sys.argv[1])`,path]);
    const result=await readDocument({mime:'image/png',data:(await readFile(path)).toString('base64')});
    assert.equal(result.method,'ocr'); assert.match(result.text,/Mesa de madeira/); assert.equal(result.items.length,2); assert.equal(result.items[0].price,150); assert.equal(result.items[1].quantity,3);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('temporary files removed after malformed PDF failure',async()=>{
  await assert.rejects(()=>readDocument({mime:'application/pdf',data:Buffer.from('%PDF-invalid').toString('base64')}),/Não foi possível/);
});
