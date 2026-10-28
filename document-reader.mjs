import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocumentText } from './document-parser.js';

const exec=promisify(execFile);
async function run(command,args,timeout=30000) {
  try { return (await exec(command,args,{timeout,maxBuffer:2*1024*1024,env:{...process.env,OMP_THREAD_LIMIT:'2'}})).stdout; }
  catch(error) {
    if (error.code==='ENOENT') throw new Error('Ferramenta de leitura ausente no servidor. Instale Poppler e Tesseract conforme o README.');
    if (error.killed || error.code==='ETIMEDOUT') throw new Error('A leitura excedeu o tempo limite. Use um arquivo menor ou o XML original.');
    throw new Error('Não foi possível ler o documento. Confira se está íntegro, legível e sem senha.');
  }
}
export async function readerStatus() {
  const languages=await run('tesseract',['--list-langs']);
  await run('pdftotext',['-v']); await run('pdfinfo',['-v']); await run('pdftoppm',['-v']);
  return {enabled:true,engine:'Poppler + Tesseract',language:languages.split(/\s+/).includes('por')?'por':'eng'};
}
export function validateFile({data,mime}={}) {
  if (!['application/pdf','image/png','image/jpeg','image/webp'].includes(mime) || typeof data!=='string' || data.length>7*1024*1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Envie PDF, PNG, JPEG ou WebP de até 5 MB.');
  const bytes=Buffer.from(data,'base64');
  if (!bytes.length || bytes.length>5*1024*1024) throw new Error('Arquivo vazio ou maior que 5 MB.');
  const magic=mime==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if (!magic) throw new Error('O conteúdo não corresponde ao formato do arquivo.');
  return bytes;
}
export async function readDocument(input) {
  const bytes=validateFile(input); const status=await readerStatus();
  const directory=await mkdtemp(join(tmpdir(),'kush-ocr-'));
  try {
    const extension={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[input.mime];
    const path=join(directory,'document.'+extension); await writeFile(path,bytes,{mode:0o600});
    let text='',method='ocr',pages=1;
    const ocr=image=>run('tesseract',[image,'stdout','-l',status.language,'--psm','6'],25000);
    if (input.mime==='application/pdf') {
      const info=await run('pdfinfo',[path]); pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      if (!Number.isInteger(pages) || pages<1 || pages>10) throw new Error('Envie um PDF com até 10 páginas. Nenhuma página foi importada.');
      const texts=[]; let usedOCR=false;
      for (let page=1;page<=pages;page++) {
        let pageText=await run('pdftotext',['-f',String(page),'-l',String(page),'-layout',path,'-']);
        // Inspect every page: mixed PDFs can contain text pages and scans.
        if (pageText.replace(/\s/g,'').length<30) {
          const prefix=join(directory,`page-${page}`);
          await run('pdftoppm',['-f',String(page),'-l',String(page),'-scale-to','2200','-singlefile','-png',path,prefix]);
          pageText=await ocr(prefix+'.png'); usedOCR=true;
        }
        texts.push(pageText);
      }
      text=texts.join('\n'); method=usedOCR?'pdf + ocr':'pdf-text';
    } else {
      // Pillow checks dimensions before the OCR process decodes potentially huge images.
      const normalized=join(directory,'normalized.png');
      await run('python3',['-c','from PIL import Image, ImageOps; import sys; im=Image.open(sys.argv[1]); assert im.width*im.height<=25000000 and im.n_frames==1, "Image too large"; ImageOps.exif_transpose(im).convert("RGB").save(sys.argv[2])',path,normalized]);
      text=await ocr(normalized);
    }
    if (!text.trim()) throw new Error('Nenhum texto legível encontrado. Envie uma imagem mais nítida ou o XML original.');
    const parsed=parseDocumentText(text);
    if (method!=='pdf-text' && status.language==='eng') parsed.warnings.push('OCR usando modelo em inglês disponível no servidor. Acentos e palavras em português podem exigir correção.');
    return {...parsed,text,method,pages,language:status.language};
  } finally { await rm(directory,{recursive:true,force:true}); }
}
