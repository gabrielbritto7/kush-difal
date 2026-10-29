import test from 'node:test';
import assert from 'node:assert/strict';
import { verticalRules,readInvoiceAmounts } from '../invoice-layout.js';
import { findTableRegions } from '../table-model.js';

test('vertical rules require continuous lines and do not mistake short text strokes for columns',()=>{
  const width=60,height=40,pixels=new Uint8ClampedArray(width*height*4).fill(255);
  for(const x of [2,20,40,58])for(let y=0;y<height;y++)for(let c=0;c<3;c++)pixels[(y*width+x)*4+c]=0;
  for(let y=0;y<8;y++)for(let c=0;c<3;c++)pixels[(y*width+10)*4+c]=0;
  assert.deepEqual(verticalRules(pixels,width,height),[2,20,40,58]);
});
test('invoice regions include wrapped descriptions, separated header lines and later products',()=>{
  const row=(text,y)=>text.split(' ').map((text,index)=>({text,x0:10+index*40,x1:40+index*40,y0:y,y1:y+10}));
  const words=[...row('VALOR VALOR ALIQ',10),...row('CODIGO DESCRICAO NCM QUANT UNIT TOTAL ICMS',25),...row('Produto 1,0000 100,0000 100,00',50),...row('Descricao continuada',70),...row('Referencia complementar',90),...row('Segundo produto 2,0000 50,0000 100,00',130),...row('DADOS ADICIONAIS',160)];
  const regions=findTableRegions(words,800,1000,{invoice:true});
  assert.equal(regions.length,1);assert.ok(regions[0].y1>140);assert.ok(regions[0].y1<165);assert.equal(regions[0].headerY0,10);
});
test('summary values are read under their own labels, including abbreviated totals and zero values',()=>{
  const words=[];const add=(text,x,y)=>{let left=x;for(const token of text.split(' ')){words.push({text:token,x0:left,x1:left+token.length*5,y0:y,y1:y+10});left+=token.length*5+5;}};
  add('V. TOTAL PRODUTOS',10,10);add('VALOR DO FRETE',250,10);add('V. TOTAL DA NOTA',450,10);
  add('1.000,00',50,35);add('0,00',300,35);add('1.000,00',500,35);add('DADOS DOS PRODUTOS',10,70);
  assert.deepEqual(readInvoiceAmounts(words),{declaredProducts:1000,declaredTotal:1000,delivery:0});
});
