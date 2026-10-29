import { BrowserTableAI } from './browser-table-ai.js';
import { wordsToLines } from './table-model.js';
import { recognizeDocument,documentKind } from './recognized-document.js';

export function readerStatus(){
  return {enabled:typeof Worker!=='undefined' && typeof WebAssembly!=='undefined' && !!globalThis.crypto?.subtle,language:'por',engine:'SLANet-plus / ONNX no navegador'};
}
function pdfWords(content,viewport,pdfjs){
  const measure=document.createElement('canvas').getContext('2d'),words=[];
  for(const item of content.items){
    if(typeof item.str!=='string'||!item.str.trim())continue;
    const transform=pdfjs.Util.transform(viewport.transform,item.transform),size=Math.hypot(transform[2],transform[3]);
    measure.font=`${size}px ${content.styles[item.fontName]?.fontFamily||'Arial'}`;
    const total=measure.measureText(item.str).width||1,width=item.width*viewport.scale;
    for(const match of item.str.matchAll(/\S+/g)){
      const x0=transform[4]+measure.measureText(item.str.slice(0,match.index)).width/total*width;
      const x1=x0+measure.measureText(match[0]).width/total*width;
      words.push({text:match[0],x0,y0:transform[5]-.85*size,x1,y1:transform[5]+.2*size,confidence:100});
    }
  }
  return words;
}
function tsvWords(tsv){
  const rows=String(tsv||'').split(/\r?\n/),words=[];
  for(const row of rows.slice(1)){
    const fields=row.split('\t');if(fields[0]!=='5'||fields.length<12||!fields.slice(11).join('\t').trim())continue;
    const [x,y,w,h,confidence]=fields.slice(6,11).map(Number);
    if(![x,y,w,h,confidence].every(Number.isFinite)||w<=0||h<=0)continue;
    words.push({text:fields.slice(11).join('\t').trim(),x0:x,y0:y,x1:x+w,y1:y+h,confidence});
  }
  return words;
}
export async function readDocument(file,onProgress=()=>{}){
  if(!file||!file.size||file.size>5*1024*1024)throw new Error('Envie um arquivo não vazio de até 5 MB.');
  const extension=file.name.split('.').pop().toLowerCase();
  if(!['pdf','png','jpg','jpeg','webp'].includes(extension))throw new Error('Use PDF, PNG, JPEG ou WebP.');
  if(!readerStatus().enabled)throw new Error('Este navegador não consegue executar a IA local. Use uma versão atual de Chrome, Edge, Firefox ou Safari.');
  const ai=new BrowserTableAI();let ocr=null,pdf=null,loading=null,bitmap=null,expired=false;
  const check=()=>{if(expired)throw new Error('Tempo limite excedido. Divida o documento ou use o XML original.');};
  const timer=setTimeout(()=>{expired=true;ai.close();ocr?.terminate();loading?.destroy();},300000);
  const recognize=async canvas=>{
    if(!ocr){
      onProgress('Carregando reconhecimento de texto em português…');
      const {default:{createWorker}}=await import('/vendor/tesseract.mjs');check();
      ocr=await createWorker('por',1,{workerPath:new URL('/vendor/ocr-worker.js',location.href).href,corePath:new URL('/vendor/core',location.href).href,langPath:new URL('/vendor/lang',location.href).href,workerBlobURL:false,logger:event=>{if(event.status==='recognizing text')onProgress(`Lendo palavras e valores: ${Math.round(event.progress*100)}%`);}});
      await ocr.setParameters({tessedit_pageseg_mode:'3',preserve_interword_spaces:'1'});
    }
    const result=await ocr.recognize(canvas,{}, {text:true,tsv:true});check();
    return tsvWords(result.data.tsv);
  };
  try{
    const tables=[],texts=[];let pages=1,textSource='pdf';
    const processPage=async(canvas,words)=>{
      check();const text=wordsToLines(words).map(line=>line.text).join('\n');texts.push(text);
      if(documentKind(text)!=='service_invoice')tables.push(...await ai.analyze(canvas,words,onProgress));
    };
    if(extension==='pdf'){
      const pdfjs=await import('/vendor/pdf.min.mjs');check();pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.min.mjs';
      loading=pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false,cMapUrl:'/vendor/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/standard_fonts/',wasmUrl:'/vendor/wasm/'});
      loading.onPassword=()=>loading.destroy();pdf=await loading.promise;pages=pdf.numPages;
      if(pages>10)throw new Error('Envie um PDF com até 10 páginas. Nenhuma página foi importada.');
      for(let number=1;number<=pages;number++){
        check();onProgress(`Preparando página ${number} de ${pages}…`);
        const page=await pdf.getPage(number),original=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(3,2400/Math.max(original.width,original.height))});
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        try{
          await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
          let words=pdfWords(await page.getTextContent(),viewport,pdfjs);
          if(words.length<15){words=await recognize(canvas);textSource='ocr';}
          await processPage(canvas,words);
        }finally{canvas.width=canvas.height=0;page.cleanup();}
      }
    }else{
      bitmap=await createImageBitmap(file);check();
      if(bitmap.width*bitmap.height>25000000)throw new Error('A imagem excede 25 megapixels. Reduza o tamanho antes de importar.');
      const scale=Math.min(2,Math.max(1,1600/bitmap.width),3000/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      try{canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);await processPage(canvas,await recognize(canvas));textSource='ocr';}finally{canvas.width=canvas.height=0;}
    }
    const text=texts.join('\n');if(!text.trim())throw new Error('Não há texto legível. Envie uma foto mais nítida ou o XML original.');
    const result=recognizeDocument(tables,text);
    return {...result,method:result.blocked?'service-detected':'browser-ai',textSource,pages,language:'por',tableCount:tables.length};
  }catch(error){
    if(expired)throw new Error('A leitura excedeu cinco minutos. Divida o documento ou use o XML original.');
    if(/password|destroyed|invalid pdf/i.test(error.message))throw new Error('PDF inválido ou protegido por senha. Use o arquivo original sem senha.');
    throw error;
  }finally{clearTimeout(timer);ai.close();bitmap?.close();if(ocr)await ocr.terminate();if(loading)await loading.destroy();}
}
