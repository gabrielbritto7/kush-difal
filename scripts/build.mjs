import { mkdir, rm, copyFile, cp, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'public');
await rm(output,{recursive:true,force:true});
await mkdir(join(output,'vendor/core'),{recursive:true});
await mkdir(join(output,'vendor/lang'),{recursive:true});
for(const file of ['index.html','styles.css','app.js','calculator.js','document-parser.js','browser-reader.js']) await copyFile(join(root,file),join(output,file));
const modules=join(root,'node_modules');
for(const file of ['pdf.min.mjs','pdf.worker.min.mjs']) await copyFile(join(modules,'pdfjs-dist/build',file),join(output,'vendor',file));
for(const folder of ['wasm','cmaps','standard_fonts']) await cp(join(modules,'pdfjs-dist',folder),join(output,'vendor',folder),{recursive:true});
await copyFile(join(modules,'tesseract.js/dist/tesseract.esm.min.js'),join(output,'vendor/tesseract.mjs'));
await copyFile(join(modules,'tesseract.js/dist/worker.min.js'),join(output,'vendor/ocr-worker.js'));
for(const file of await readdir(join(modules,'tesseract.js-core'))) if(/lstm\.wasm(?:\.js)?$/.test(file)) await copyFile(join(modules,'tesseract.js-core',file),join(output,'vendor/core',file));
await copyFile(join(modules,'@tesseract.js-data/por/4.0.0/por.traineddata.gz'),join(output,'vendor/lang/por.traineddata.gz'));
await mkdir(join(output,'vendor/licenses'),{recursive:true});
for(const [pkg,name] of [['pdfjs-dist','pdfjs'],['tesseract.js','tesseract'],['tesseract.js-core','tesseract-core'],['@tesseract.js-data/por','por']]) {
  const directory=join(modules,pkg); const files=await readdir(directory);
  for(const file of files.filter(x=>/^licen[cs]e/i.test(x))) await cp(join(directory,file),join(output,'vendor/licenses',name+'-'+file),{recursive:true});
  if(pkg==='@tesseract.js-data/por') await copyFile(join(directory,'README.md'),join(output,'vendor/licenses/por-README.md'));
}
console.log('Site estático gerado em public/ com PDF.js, OCR e modelo em português.');
