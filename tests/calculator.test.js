import test from 'node:test';
import assert from 'node:assert/strict';
import { interstateRate, calculate, parseCSV, parseNumber } from '../calculator.js';
const item = {description:'Mesa',ncm:'94036000',quantity:2,price:150,freight:20,other:10,discount:5};
const config = {items:[item],origin:'SP',destination:'RJ',internalRate:20,interstate:12,fcp:2};
test('products are the simulation base; freight, expenses and discounts remain informational',()=>{
  const result=calculate(config); assert.equal(result.base,300); assert.equal(result.difal,24); assert.equal(result.povertyFund,6); assert.equal(result.total,30);
  assert.equal(result.baseCriterion,'products');assert.equal(result.rows[0].freight,20);assert.equal(result.rows[0].other,10);assert.equal(result.rows[0].discount,5);
});
test('interstate rates by route and imported goods',()=>{
  assert.equal(interstateRate('SP','BA'),7); assert.equal(interstateRate('SP','ES'),7); assert.equal(interstateRate('ES','SP'),12); assert.equal(interstateRate('SP','RJ'),12); assert.equal(interstateRate('SP','RJ',true),4); assert.equal(interstateRate('SP','SP',true),0); assert.throws(()=>interstateRate('XX','SP'));
});
test('same state and ineligible transactions do not charge interstate DIFAL or FCP',()=>{
  assert.equal(calculate({...config,destination:'SP'}).total,0); assert.equal(calculate({...config,eligible:false}).total,0);
});
test('round each item before summing',()=>{
  const result=calculate({...config,items:Array.from({length:3},()=>({...item,quantity:1,price:0.1,freight:0,other:0,discount:0})),internalRate:18,interstate:12,fcp:0}); assert.equal(result.difal,0.03);
});
test('mixed invoice interstate rates are applied per item and can be explicitly overridden',()=>{
  const items=[{...item,quantity:1,price:100,freight:0,other:0,discount:0,interstateRate:12},{...item,quantity:1,price:200,freight:0,other:0,discount:0,interstateRate:4}];
  const result=calculate({...config,items,internalRate:19.5,fcp:0});
  assert.equal(result.difal,38.5);assert.deepEqual(result.rows.map(row=>row.appliedInterstate),[12,4]);
  assert.equal(calculate({...config,items,internalRate:19.5,fcp:0,useItemRates:false}).difal,22.5);
  assert.throws(()=>calculate({...config,items:[{...items[0],interstateRate:NaN}]}),/inválida/);
  assert.throws(()=>calculate({...config,items:[{...items[0],interstateRate:25}]}),/superior/);
});
test('reject invalid numbers, negative inputs and mismatched rates',()=>{
  assert.throws(()=>calculate({...config,internalRate:NaN})); assert.throws(()=>calculate({...config,internalRate:10})); assert.throws(()=>calculate({...config,items:[{...item,quantity:0}]})); assert.throws(()=>calculate({...config,items:[{...item,discount:-1}]})); assert.throws(()=>calculate({...config,fcp:100}));
});
test('CSV Brazilian decimal, accented headers, quotes and multiline cells',()=>{
  const rows=parseCSV('\uFEFFDescrição;NCM;Quantidade;Valor unitário;Frete\r\n"Mesa; de \"\"madeira\"\"\nclara";94036000;2;1.234,50;20,00\r\n');
  assert.equal(rows.length,1); assert.equal(rows[0].price,1234.5); assert.equal(rows[0].description,'Mesa; de "madeira"\nclara'); assert.equal(rows[0].freight,20);
});
test('CSV comma separated and invalid input handling',()=>{
  assert.equal(parseCSV('descricao,quantidade,valor_unitario\nMesa,1,15.99')[0].price,15.99);
  assert.throws(()=>parseCSV('produto,valor\nMesa,10')); assert.throws(()=>parseCSV('descricao;quantidade;valor_unitario\nMesa;1;abc')); assert.throws(()=>parseCSV('descricao;quantidade;valor_unitario\n"Mesa;1;10')); assert.throws(()=>parseCSV('descricao;quantidade;valor_unitario\nMesa;;10')); assert.throws(()=>parseNumber('abc'));
});
