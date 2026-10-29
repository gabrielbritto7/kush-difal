// Real browser/model smoke test. Never mocks inference or publishes input documents.
import { chromium } from 'playwright-core';
import { readFile,mkdtemp,writeFile,rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

function argument(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;}
function pdfDocument(lines){
  const content='BT /F1 11 Tf 35 780 Td 22 TL '+lines.map((line,i)=>(i?'T* ':'')+'('+line.replace(/[\\()]/g,'\\$&')+') Tj').join('\n')+' ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let text='%PDF-1.4\n';const offsets=[];
  for(const [i,object]of objects.entries()){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(text);text+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}

const directory=await mkdtemp(join(tmpdir(),'kush-ai-smoke-'));
let server,browser;
try{
  let budget=argument('--budget');
  if(!budget){
    const row=(description,quantity,price,total)=>description.padEnd(24)+quantity.padEnd(10)+price.padEnd(16)+total;
    budget=join(directory,'budget.pdf');
    await writeFile(budget,pdfDocument(['ORCAMENTO DE TESTE','Origem: SP','Destino: RJ',row('Descricao','Qtd','Valor unitario','Total'),row('Componente Alfa','2,00','100,00','200,00'),row('Componente Beta','3,00','50,00','150,00'),'Valor Total Produtos: 350,00','Taxa de Entrega: 20,00','Total Orcamento: 370,00']));
  }
  const count=Number(argument('--expected-count')||2),base=Number(argument('--expected-base')||370);
  const origin=process.env.TEST_BASE_URL||'http://127.0.0.1:3035';
  if(!process.env.TEST_BASE_URL){
    server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'3035'},stdio:'pipe'});
    let ready=false;
    for(let i=0;i<60;i++){
      if(server.exitCode!==null)throw new Error('Test server exited. Run npm run build first or choose TEST_BASE_URL.');
      try{ready=(await fetch(origin,{signal:AbortSignal.timeout(500)})).ok;}catch{}
      if(ready)break;await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!ready)throw new Error('Test server did not become ready.');
  }
  const executable=process.env.BROWSER_PATH||(['/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync));
  browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
  await page.goto(origin);
  assert.equal(await page.locator('#reader-service').count(),0,'No backend connection field');
  assert.equal(await page.locator('#reader-mode').count(),0,'No separate backend mode');
  async function upload(file){
    if(await page.locator('#reader-dialog').evaluate(element=>element.open))await page.locator('#reader-dialog .close-dialog').click();
    await page.setInputFiles('#file-input',file);
    await page.waitForFunction(()=>!document.querySelector('#reader-review').hidden||!!document.querySelector('#reader-error').textContent,null,{timeout:120000});
    assert.equal(await page.textContent('#reader-error'),'');
  }
  async function expectBudget(file){
    await upload(file);assert.equal(await page.locator('#reader-auto-body tr').count(),count);
    assert.match(await page.textContent('#reader-status'),/Reconhecimento concluído/);
    assert.match(await page.textContent('#reader-summary'),new RegExp(base.toLocaleString('pt-BR',{minimumFractionDigits:2}).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.equal(await page.locator('#reader-import').isDisabled(),true);
    await page.check('#reader-reviewed');assert.equal(await page.locator('#reader-import').isDisabled(),false);
  }
  await expectBudget(budget);await page.click('#reader-import');
  assert.equal(await page.locator('#items-body tr').count(),count);
  await page.selectOption('#origin','SP');await page.selectOption('#destination','RJ');await page.fill('#internal-rate','20');await page.fill('#fcp-rate','0');await page.check('#eligible');await page.click('#calculate-button');
  assert.equal(await page.locator('#export-button').isDisabled(),false);assert.match(await page.textContent('#message'),/concluída/);
  for(const flag of ['--photo','--scan']){const file=argument(flag);if(file)await expectBudget(file);}
  const service=argument('--service');
  if(service){await upload(service);assert.match(await page.textContent('#reader-result'),/NFS-e/);assert.equal(await page.locator('#reader-products-section').isVisible(),false);assert.equal(await page.locator('#reader-import').isDisabled(),true);assert.equal(await page.locator('#items-body tr').count(),count);}
  if(await page.locator('#reader-dialog').evaluate(element=>element.open))await page.locator('#reader-dialog .close-dialog').click();
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(requests.some(request=>request.url.endsWith('/assets/models/table.onnx')),true,'Real model was loaded');
  assert.equal(requests.some(request=>request.method!=='GET'),false,'Documents were not uploaded');
  assert.equal(requests.some(request=>request.url.startsWith('http')&&!request.url.startsWith(origin)),false,'No external runtime requests');
  assert.deepEqual(errors,[]);
  console.log('PASS: real browser AI, automatic recognition, totals, calculation, no manual item entry, no backend, no uploads, mobile layout'+(service?', NFS-e correctly blocked':'')+'.');
}finally{
  await browser?.close();server?.kill('SIGTERM');await rm(directory,{recursive:true,force:true});
}
