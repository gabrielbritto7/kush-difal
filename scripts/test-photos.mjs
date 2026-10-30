import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { budgetPhoto } from '../tests/fixtures/budget-photo.mjs';

const origin=process.env.TEST_BASE_URL||'http://127.0.0.1:3043';
const amount=text=>Number(text.replace(/[^\d,-]/g,'').replace(',','.'));
let server,browser;
try{
  if(!process.env.TEST_BASE_URL){
    server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'3043'},stdio:'pipe'});
    let ready=false;
    for(let attempt=0;attempt<60;attempt++){
      if(server.exitCode!==null)throw new Error('O servidor do teste encerrou.');
      try{ready=(await fetch(origin,{signal:AbortSignal.timeout(500)})).ok;}catch{}
      if(ready)break;await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!ready)throw new Error('Execute npm run build antes do teste.');
  }
  const proxy=origin.startsWith('https:')&&(process.env.HTTPS_PROXY||process.env.HTTP_PROXY);
  const executable=process.env.BROWSER_PATH||['/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
  browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox'],...(proxy?{proxy:{server:proxy}}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
  await page.goto(origin);
  async function upload(options){
    const format=options.format||'png',buffer=Buffer.from(await page.evaluate(budgetPhoto,options),'base64');
    await page.setInputFiles('#file-input',{name:`budget.${format==='jpeg'?'jpg':format}`,mimeType:'image/'+format,buffer});
    await page.waitForFunction(()=>!document.querySelector('#reader-review').hidden||!!document.querySelector('#reader-error').textContent,null,{timeout:180000});
    assert.equal(await page.textContent('#reader-error'),'');
    assert.equal(await page.locator('#reader-auto-body tr').count(),2);
  }
  const examples=[{width:776},{width:1200},{width:776,rotation:1.2,format:'jpeg'},{width:1200,format:'webp'},{width:776,transparent:true,origin:false}];
  for(const [index,options]of examples.entries()){
    await upload(options);
    assert.match(await page.textContent('#reader-status'),/Reconhecimento concluído/);
    assert.match(await page.textContent('#reader-summary'),/Produtos conferem com o total declarado/,'The printed products total must be recovered and reconciled');
    assert.match(await page.textContent('#reader-auto-body tr:first-child td:nth-child(2)'),/ALAVANCA MODELO-A/);
    assert.match(await page.textContent('#reader-auto-body tr:nth-child(2) td:nth-child(2)'),/ANEL MODELO-B/);
    assert.equal(amount(await page.textContent('#reader-auto-body tr:first-child td:nth-child(4)')),1);
    assert.equal(amount(await page.textContent('#reader-auto-body tr:nth-child(2) td:nth-child(4)')),2);
    assert.equal(amount(await page.textContent('#reader-auto-body tr:first-child td:nth-child(5)')),180.25);
    assert.equal(amount(await page.textContent('#reader-auto-body tr:nth-child(2) td:nth-child(5)')),19.5);
    assert.equal(await page.locator('#reader-import').isDisabled(),true);
    await page.check('#reader-reviewed');assert.equal(await page.locator('#reader-import').isDisabled(),false);
    if(index)page.once('dialog',dialog=>dialog.accept());
    await page.click('#reader-import');
    assert.equal(await page.inputValue('#origin'),options.origin===false?'':'SC');
    assert.equal(await page.inputValue('#destination'),'PR');assert.equal(await page.inputValue('#internal-rate'),'19.5');
    assert.equal(await page.locator('#items-body tr').count(),2);
    if(options.origin===false)await page.selectOption('#origin','SC');
    await page.click('#calculate-button');assert.equal(await page.locator('#export-button').isDisabled(),false);
    assert.equal(amount(await page.textContent('#summary-base')),199.75);assert.equal(amount(await page.textContent('#summary-difal')),14.98);
    console.log('PASS: photo '+JSON.stringify(options)+' — descriptions, quantities, totals, UFs, automatic rates and calculation.');
  }
  const previous=await page.textContent('#summary-grand-total');
  await upload({width:1200,inconsistent:true});
  await page.check('#reader-reviewed');assert.equal(await page.locator('#reader-import').isDisabled(),true);
  assert.equal(await page.textContent('#summary-grand-total'),previous,'An incomplete photo cannot replace the previous calculation');
  await page.locator('#reader-dialog .close-dialog').click();
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(requests.some(request=>request.url.endsWith('/assets/models/table.onnx')),true,'The neural model really ran');
  assert.equal(requests.some(request=>request.method!=='GET'),false,'No document uploads');
  assert.equal(requests.some(request=>request.url.startsWith('http')&&!request.url.startsWith(origin)),false,'No external runtime service');
  assert.deepEqual(errors,[]);
  console.log('PASS: inconsistent photo blocked; previous result preserved; real OCR and model; no uploads; mobile layout.');
}finally{await browser?.close();server?.kill('SIGTERM');}
