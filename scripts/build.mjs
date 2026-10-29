import { mkdir, rm, copyFile, cp, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { TABLE_MODEL } from '../table-model.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'public');
const model=await readFile(join(root,'assets/models/table.onnx'));
if(model.length!==TABLE_MODEL.size||createHash('sha256').update(model).digest('hex')!==TABLE_MODEL.sha256)throw new Error('O modelo de IA não confere com o hash esperado.');
await rm(output,{recursive:true,force:true});
await mkdir(join(output,'vendor/core'),{recursive:true});
await mkdir(join(output,'vendor/lang'),{recursive:true});
for(const file of ['index.html','styles.css','app.js','calculator.js','icms-rates.js','document-parser.js','document-route.js','browser-reader.js','table-model.js','table-ai.worker.js','browser-table-ai.js','recognized-document.js']) await copyFile(join(root,file),join(output,file));
const modules=join(root,'node_modules');
await mkdir(join(output,'vendor/ort'),{recursive:true});
for(const file of ['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']) await copyFile(join(modules,'onnxruntime-web/dist',file),join(output,'vendor/ort',file));

await cp(join(root,'assets'),join(output,'assets'),{recursive:true});
await mkdir(join(output,'assets/fonts'),{recursive:true});
await mkdir(join(output,'assets/licenses'),{recursive:true});
for(const [font,weights] of [['fredoka',[500,600]],['quicksand',[500,600,700]]]) {
  for(const weight of weights) {const file=`${font}-latin-${weight}-normal.woff2`; await copyFile(join(modules,'@fontsource',font,'files',file),join(output,'assets/fonts',file));}
  await copyFile(join(modules,'@fontsource',font,'LICENSE'),join(output,'assets/licenses',font+'.txt'));
}
for(const file of ['pdf.min.mjs','pdf.worker.min.mjs']) await copyFile(join(modules,'pdfjs-dist/build',file),join(output,'vendor',file));
for(const folder of ['wasm','cmaps','standard_fonts']) await cp(join(modules,'pdfjs-dist',folder),join(output,'vendor',folder),{recursive:true});
await copyFile(join(modules,'tesseract.js/dist/tesseract.esm.min.js'),join(output,'vendor/tesseract.mjs'));
await copyFile(join(modules,'tesseract.js/dist/worker.min.js'),join(output,'vendor/ocr-worker.js'));
for(const file of await readdir(join(modules,'tesseract.js-core'))) if(/lstm\.wasm(?:\.js)?$/.test(file)) await copyFile(join(modules,'tesseract.js-core',file),join(output,'vendor/core',file));
await copyFile(join(modules,'@tesseract.js-data/por/4.0.0/por.traineddata.gz'),join(output,'vendor/lang/por.traineddata.gz'));
await mkdir(join(output,'vendor/licenses'),{recursive:true});
for(const [pkg,name] of [['onnxruntime-web','onnxruntime-web'],['pdfjs-dist','pdfjs'],['tesseract.js','tesseract'],['tesseract.js-core','tesseract-core'],['@tesseract.js-data/por','por']]) {
  const directory=join(modules,pkg); const files=await readdir(directory);
  for(const file of files.filter(x=>/^licen[cs]e/i.test(x))) await cp(join(directory,file),join(output,'vendor/licenses',name+'-'+file),{recursive:true});
  if(pkg==='@tesseract.js-data/por') await copyFile(join(directory,'README.md'),join(output,'vendor/licenses/por-README.md'));
}
console.log('Site estático gerado em public/ com IA SLANet-plus, ONNX, PDF.js e OCR em português.');
