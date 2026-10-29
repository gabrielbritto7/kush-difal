import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TABLE_MODEL,TABLE_TOKENS,normalizeTableImage,cellStructure,findTableRegions,matchTableWords } from '../table-model.js';

test('the distributed neural model matches the pinned converted artifact hash',async()=>{
  const bytes=await readFile(new URL('../assets/models/table.onnx',import.meta.url));
  assert.equal(bytes.length,TABLE_MODEL.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),TABLE_MODEL.sha256);assert.equal(TABLE_TOKENS.length,50);
});
test('preprocessing uses Paddle BGR normalization and zero padding',()=>{
  const input=normalizeTableImage(new Uint8Array([255,0,0,255]),1,1,2);
  assert.ok(Math.abs(input[0]-(-.485/.229))<1e-5);assert.ok(Math.abs(input[8]-((1-.406)/.225))<1e-5);assert.equal(input[1],0);
});
test('row and column spans preserve positions in the learned structure',()=>{
  const cells=cellStructure(['<tr>','<td',' rowspan="2"','>','</td>','<td></td>','</tr>','<tr>','<td></td>','</tr>']);
  assert.equal(cells[0].rowspan,2);assert.equal(cells[2].column,1);assert.equal(cells[2].row,1);
});
test('an OCR typo in quantity does not force analysis of an entire page',()=>{
  const lines=[['Código Descrição OQOTDE. VLR. UNIT. TOTAL',10],['Parafuso 2,00 10,00 20,00',30],['Valor Total Produtos: 20,00',50]];
  const words=lines.flatMap(([line,y])=>line.split(' ').map((text,i)=>({text,x0:10+i*50,y0:y,x1:50+i*50,y1:y+10})));
  const regions=findTableRegions(words,800,1000);assert.equal(regions.length,1);assert.ok(regions[0].y1<55);
});
test('recognized text is data, not executable HTML',()=>{
  const words=[{text:'<script>bad()</script>',x0:0,y0:0,x1:80,y1:10}];
  const result=matchTableWords({tags:['<tr>','<td></td>','</tr>'],boxes:[[0,0,90,15]],confidence:.99},words,{x0:0,y0:0});
  assert.equal(result.rows[0][0],words[0].text);
});
