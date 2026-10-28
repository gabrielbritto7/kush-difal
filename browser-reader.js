import { parseDocumentText } from './document-parser.js';

export function readerStatus() {
  return {enabled:typeof Worker!=='undefined' && typeof WebAssembly!=='undefined',language:'por'};
}
function layoutText(content) {
  const lines=[];
  for(const item of content.items.filter(x=>typeof x.str==='string' && x.str.trim()).sort((a,b)=>Math.abs(a.transform[5]-b.transform[5])>3 ? b.transform[5]-a.transform[5] : a.transform[4]-b.transform[4])) {
    const y=item.transform[5],x=item.transform[4]; let line=lines.find(l=>Math.abs(l.y-y)<3);
    if(!line) {line={y,items:[]};lines.push(line);} line.items.push({x,width:item.width,text:item.str,fontSize:Math.abs(item.transform[0])});
  }
  return lines.sort((a,b)=>b.y-a.y).map(line=>{
    let end=0; return line.items.sort((a,b)=>a.x-b.x).map((item,index)=>{const gap=item.x-end;end=item.x+item.width;return (index?(gap>Math.max(8,item.fontSize*.85)?'  ':' '):'')+item.text;}).join('');
  }).join('\n');
}
export async function readDocument(file,onProgress=()=>{}) {
  if(!file || !file.size || file.size>5*1024*1024) throw new Error('Envie um arquivo não vazio de até 5 MB.');
  const extension=file.name.split('.').pop().toLowerCase();
  if(!['pdf','png','jpg','jpeg','webp'].includes(extension)) throw new Error('Use PDF, PNG, JPEG ou WebP.');
  let worker=null,pdf=null,loading=null,bitmap=null,timer;
  let expired=false;
  const check=()=>{if(expired)throw new Error('Tempo limite excedido. Divida o documento ou use XML.');};
  const getWorker=async()=>{
    if(!worker) {
      onProgress('Carregando o modelo OCR em português…');
      const {default:{createWorker}}=await import('/vendor/tesseract.mjs'); check();
      worker=await createWorker('por',1,{workerPath:new URL('/vendor/ocr-worker.js',location.href).href,corePath:new URL('/vendor/core',location.href).href,langPath:new URL('/vendor/lang',location.href).href,workerBlobURL:false,logger:event=>{if(event.status==='recognizing text')onProgress(`Reconhecendo texto: ${Math.round(event.progress*100)}%`);}});
      check(); await worker.setParameters({tessedit_pageseg_mode:'6'});
    }
    return worker;
  };
  const recognize=async image=>{check();const instance=await getWorker(); const result=await instance.recognize(image);check();return result.data.text;};
  timer=setTimeout(()=>{expired=true;if(worker)worker.terminate();if(loading)loading.destroy();},300000);
  try {
    let text='',pages=1,method='ocr';
    if(extension==='pdf') {
      const pdfjs=await import('/vendor/pdf.min.mjs'); check();
      pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.min.mjs';
      loading=pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false,cMapUrl:'/vendor/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/standard_fonts/',wasmUrl:'/vendor/wasm/'});
      loading.onPassword=()=>{loading.destroy();};
      pdf=await loading.promise;check();pages=pdf.numPages;
      if(pages>10)throw new Error('Envie um PDF com até 10 páginas. Nenhuma página foi importada.');
      const texts=[];let usedOCR=false;
      for(let pageNumber=1;pageNumber<=pages;pageNumber++) {
        check();onProgress(`Lendo página ${pageNumber} de ${pages}…`);
        const page=await pdf.getPage(pageNumber);let pageText=layoutText(await page.getTextContent());
        if(pageText.replace(/\s/g,'').length<30) {
          const original=page.getViewport({scale:1});const viewport=page.getViewport({scale:Math.min(3,2200/Math.max(original.width,original.height))});
          const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
          try {await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;pageText=await recognize(canvas);usedOCR=true;} finally {canvas.width=canvas.height=0;}
        }
        texts.push(pageText);page.cleanup();
      }
      text=texts.join('\n');method=usedOCR?'pdf + ocr':'pdf-text';
    } else {
      bitmap=await createImageBitmap(file);check();
      if(bitmap.width*bitmap.height>25000000)throw new Error('A imagem excede 25 megapixels. Reduza o tamanho antes de importar.');
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      try {canvas.getContext('2d').drawImage(bitmap,0,0);text=await recognize(canvas);} finally {canvas.width=canvas.height=0;}
    }
    if(!text.trim())throw new Error('Nenhum texto legível encontrado. Use uma imagem mais nítida ou o XML original.');
    return {...parseDocumentText(text),text,pages,method,language:'por'};
  } catch(error) {
    if(expired)throw new Error('Tempo limite excedido. Divida o documento ou use XML.');
    if(/password|destroyed|invalid pdf/i.test(error.message))throw new Error('Não foi possível ler o PDF. Confira se está íntegro e sem senha.');
    throw error;
  } finally {
    clearTimeout(timer); bitmap?.close(); if(worker)await worker.terminate(); if(loading)await loading.destroy();
  }
}
