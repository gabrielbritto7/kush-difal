import { chromium } from 'playwright-core';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { invoicePDF } from '../tests/fixtures/invoice-pdf.mjs';

function argument(name){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:undefined;}
const amount=text=>Number(text.replace(/[^\d,-]/g,'').replace(',','.'));
const directory=await mkdtemp(join(tmpdir(),'kush-invoice-test-'));
const origin=process.env.TEST_BASE_URL||'http://127.0.0.1:3038';
let server,browser;
try{
  if(!process.env.TEST_BASE_URL){
    server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'3038'},stdio:'pipe'});
    let ready=false;
    for(let i=0;i<60;i++){if(server.exitCode!==null)throw new Error('O servidor do teste encerrou.');try{ready=(await fetch(origin,{signal:AbortSignal.timeout(500)})).ok;}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,100));}
    if(!ready)throw new Error('Execute npm run build antes do teste.');
  }
  const proxy=origin.startsWith('https:')&&(process.env.HTTPS_PROXY||process.env.HTTP_PROXY);
  const executable=process.env.BROWSER_PATH||['/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
  browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox'],...(proxy?{proxy:{server:proxy}}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
  await page.goto(origin);
  const file=argument('--pdf');
  const cases=file?[{name:'documento-privado.pdf',buffer:await readFile(file),count:Number(argument('--expected-count')),base:Number(argument('--expected-base')),source:argument('--expected-origin'),destination:argument('--expected-destination'),rates:argument('--expected-rates')?.split(',').map(Number),difal:argument('--expected-difal')===undefined?undefined:Number(argument('--expected-difal')),ncm:Number(argument('--expected-ncm-count')??argument('--expected-count'))}]:[
    {name:'invoice-multipage.pdf',buffer:invoicePDF(),count:2,base:200,source:'SP',destination:'PR',rates:[4,12],difal:23,ncm:2},
    {name:'invoice-combined-unit.pdf',buffer:invoicePDF({combinedUnit:true}),count:2,base:200,source:'SP',destination:'PR',rates:[4,12],difal:23,ncm:2},
    {name:'invoice-different-total.pdf',buffer:invoicePDF({noteExtra:.17}),count:2,base:200,source:'SP',destination:'PR',rates:[4,12],difal:23,ncm:2},
  ];
  for(const [index,example]of cases.entries()){
    assert.ok(example.count>0&&Number.isFinite(example.base),'Informe quantidade e base esperadas para um PDF privado.');
    if(index)page.once('dialog',dialog=>dialog.accept());
    await page.setInputFiles('#file-input',{name:example.name,mimeType:'application/pdf',buffer:example.buffer});
    await page.waitForFunction(()=>!document.querySelector('#reader-review').hidden||!!document.querySelector('#reader-error').textContent,null,{timeout:180000});
    assert.equal(await page.textContent('#reader-error'),'');assert.match(await page.textContent('#reader-status'),/Reconhecimento concluído/);
    assert.match(await page.textContent('#reader-summary'),/Produtos conferem com o total declarado/);
    assert.match(await page.textContent('#reader-summary'),/Total da nota \/ orçamento \(informativo\)/);
    assert.equal(await page.locator('#reader-auto-body tr').count(),example.count);
    const ncm=await page.locator('#reader-auto-body tr td:nth-child(3)').allTextContents();assert.equal(ncm.filter(value=>/^\d{8}$/.test(value)).length,example.ncm);
    if(example.rates){const values=await page.locator('#reader-auto-body tr td:last-child').allTextContents();assert.deepEqual([...new Set(values.map(value=>Number(value.replace('%',''))))].sort((a,b)=>a-b),example.rates);}
    if(!file&&!index){
      await page.locator('#reader-edit-details').evaluate(element=>element.open=true);
      const price=page.locator('#reader-products input[data-field="price"]').first(),original=await price.inputValue();
      await price.fill(String(Number(original)+1));await page.check('#reader-reviewed');await page.click('#reader-import');
      assert.match(await page.textContent('#reader-error'),/valor total dos produtos/);
      assert.equal(await page.locator('#reader-dialog').evaluate(element=>element.open),true);
      assert.equal(await page.locator('#items-body tr').count(),0);
      await price.fill(original);await page.locator('#reader-edit-details').evaluate(element=>element.open=false);
    }
    await page.check('#reader-reviewed');await page.click('#reader-import');
    if(example.source!==undefined)assert.equal(await page.inputValue('#origin'),example.source);
    if(example.destination!==undefined)assert.equal(await page.inputValue('#destination'),example.destination);
    assert.equal(await page.locator('#eligible').isChecked(),true);
    if(example.rates?.length)assert.equal(await page.locator('#use-invoice-rates').isChecked(),true);
    await page.click('#calculate-button');assert.equal(await page.locator('#export-button').isDisabled(),false);
    assert.equal(amount(await page.textContent('#summary-base')),example.base);
    const tax=amount(await page.textContent('#summary-difal'));
    if(example.difal!==undefined)assert.equal(tax,example.difal);
    if(example.rates?.length>1){
      assert.equal(await page.textContent('#difal-percent'),'por item');
      await page.uncheck('#use-invoice-rates');await page.click('#calculate-button');
      assert.notEqual(amount(await page.textContent('#summary-difal')),tax,'A mixed invoice cannot be flattened into one rate');
      await page.check('#use-invoice-rates');await page.click('#calculate-button');assert.equal(amount(await page.textContent('#summary-difal')),tax);
      const destination=await page.inputValue('#destination');
      await page.selectOption('#destination',destination==='BA'?'PR':'BA');assert.equal(await page.locator('#interstate-rate').getAttribute('readonly'),null);
      assert.match(await page.textContent('#invoice-rates-note'),/rota foi alterada/);
      await page.selectOption('#destination',destination);await page.click('#calculate-button');assert.equal(amount(await page.textContent('#summary-difal')),tax);
    }
    const event=page.waitForEvent('download');await page.click('#export-button');const download=await event;await download.saveAs(join(directory,'calculation.csv'));
    const exported=await readFile(join(directory,'calculation.csv'),'utf8');
    assert.match(exported,/ICMS interestadual aplicado/);assert.match(exported,/Base \(produtos\)/);assert.match(exported,/Critério da base/);
    console.log('PASS: '+(file?'documento privado':example.name)+' — produtos, NCMs, totais, alíquotas por item, cálculo e exportação.');
  }
  if(!file){
    const previous=await page.textContent('#summary-grand-total');
    await page.setInputFiles('#file-input',{name:'incomplete.pdf',mimeType:'application/pdf',buffer:invoicePDF({inconsistent:true})});
    await page.waitForFunction(()=>!document.querySelector('#reader-review').hidden,null,{timeout:120000});
    await page.check('#reader-reviewed');assert.equal(await page.locator('#reader-import').isDisabled(),true);
    assert.equal(await page.textContent('#summary-grand-total'),previous,'A partial reading cannot replace a successful calculation');
    await page.locator('#reader-dialog .close-dialog').click();
    const xml=declared=>`<NFe><infNFe><ide><indFinal>1</indFinal></ide><emit><enderEmit><UF>SP</UF></enderEmit></emit><dest><enderDest><UF>PR</UF></enderDest><indIEDest>9</indIEDest></dest><det><prod><xProd>Componente Alfa</xProd><qCom>1</qCom><vProd>100</vProd><vFrete>20</vFrete><vDesc>5</vDesc></prod><imposto><ICMS><ICMS00><pICMS>12</pICMS></ICMS00></ICMS><IPI><IPITrib><vIPI>10</vIPI></IPITrib></IPI></imposto></det><det><prod><xProd>Componente Beta</xProd><qCom>2</qCom><vProd>100</vProd></prod><imposto><ICMS><ICMS00><pICMS>12</pICMS></ICMS00></ICMS></imposto></det><total><ICMSTot><vProd>${declared}</vProd><vNF>225.17</vNF></ICMSTot></total></infNFe></NFe>`;
    page.once('dialog',dialog=>dialog.accept());
    await page.setInputFiles('#file-input',{name:'products-base.xml',mimeType:'application/xml',buffer:Buffer.from(xml(200))});
    await page.waitForFunction(()=>document.querySelector('#file-name').textContent==='products-base.xml');
    assert.equal(amount(await page.textContent('#base-total')),200);await page.click('#calculate-button');
    assert.equal(amount(await page.textContent('#summary-base')),200);assert.equal(amount(await page.textContent('#summary-difal')),15);
    const xmlResult=await page.textContent('#summary-grand-total');
    await page.setInputFiles('#file-input',{name:'wrong-products.xml',mimeType:'application/xml',buffer:Buffer.from(xml(300))});
    await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('valor total dos produtos'));
    assert.match(await page.textContent('#message'),/valor total dos produtos/);assert.equal(await page.textContent('#summary-grand-total'),xmlResult);
    console.log('PASS: XML uses vProd without charges; an inconsistent products total is blocked.');
  }
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(requests.some(request=>request.url.endsWith('/assets/models/table.onnx')),true,'Real neural inference was run');
  assert.equal(requests.some(request=>request.method!=='GET'),false,'No document uploads');
  assert.equal(requests.some(request=>request.url.startsWith('http')&&!request.url.startsWith(origin)),false,'No external inference service');
  assert.deepEqual(errors,[]);
}finally{await browser?.close();server?.kill('SIGTERM');await rm(directory,{recursive:true,force:true});}
