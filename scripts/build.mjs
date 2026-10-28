import { mkdir, rm, copyFile, cp, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'public');
await rm(output,{recursive:true,force:true});
await mkdir(join(output,'vendor/core'),{recursive:true});
await mkdir(join(output,'vendor/lang'),{recursive:true});
for(const file of ['index.html','styles.css','app.js','calculator.js','document-parser.js','browser-reader.js','document-ai-client.js']) await copyFile(join(root,file),join(output,file));
await writeFile(join(output,'app-config.json'),JSON.stringify({documentAIUrl:process.env.DOCUMENT_AI_URL || ''}));
const modules=join(root,'node_modules');
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
for(const [pkg,name] of [['pdfjs-dist','pdfjs'],['tesseract.js','tesseract'],['tesseract.js-core','tesseract-core'],['@tesseract.js-data/por','por']]) {
  const directory=join(modules,pkg); const files=await readdir(directory);
  for(const file of files.filter(x=>/^licen[cs]e/i.test(x))) await cp(join(directory,file),join(output,'vendor/licenses',name+'-'+file),{recursive:true});
  if(pkg==='@tesseract.js-data/por') await copyFile(join(directory,'README.md'),join(output,'vendor/licenses/por-README.md'));
}
console.log('Site estático gerado em public/ com PDF.js, OCR e modelo em português.');
