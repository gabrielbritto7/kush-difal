import { findTableRegions,wordsToLines } from './table-model.js';
import { fieldName,normalize } from './recognized-document.js';

const center=word=>(word.y0+word.y1)/2;
const inside=(word,left,right)=>(word.x0+word.x1)/2>=left&&(word.x0+word.x1)/2<right;

function headerColumns(words){
  const columns=[],ordered=[...words].sort((a,b)=>a.x0-b.x0);
  for(let index=0;index<ordered.length;index++){
    const first=ordered[index];let text=first.text,last=first,field=fieldName(text);
    // Join short labels such as "VLR. UNIT." only until their meaning is explicit.
    if(!field)for(let depth=1;depth<3&&index+depth<ordered.length;depth++){
      const next=ordered[index+depth];
      if(next.x0-last.x1>Math.max(first.y1-first.y0,next.y1-next.y0)*2)break;
      text+=' '+next.text;last=next;field=fieldName(text);
      if(field){index+=depth;break;}
    }
    if(!field){text=first.text;last=first;}
    columns.push({text,field,x0:first.x0,x1:last.x1});
  }
  return columns;
}

// OCR can read every word while the neural model merges or shifts cells in a short table.
// Explicit headings and their page positions offer an independent, arithmetic-checked reading.
export function readAlignedBudgetTables(words,width,height){
  const tables=[];
  for(const region of findTableRegions(words,width,height)){
    const headerWords=words.filter(word=>center(word)>=region.headerY0-1&&center(word)<=region.headerY1+1);
    const columns=headerColumns(headerWords),roles=columns.map(column=>column.field);
    const description=roles.indexOf('description'),numeric=['quantity','price','total'].map(role=>roles.indexOf(role));
    if(description<0||numeric.some(index=>index<0))continue;
    // Repeated monetary headings or merged labels are ambiguous; keep the neural reading.
    if(['quantity','price','total'].some(role=>roles.filter(value=>value===role).length!==1))continue;
    const gutter=Math.max(2,(region.headerY1-region.headerY0)*.5);
    const edges=columns.map((column,index)=>index===0?region.x0:column.x0-Math.min(gutter,Math.max(0,(column.x0-columns[index-1].x1)/2)));
    edges.push(region.x1);
    const firstNumeric=Math.min(...numeric);
    // Keep the brand or other descriptive text when a printed heading is shifted over a name.
    // Codes and explicitly labelled NCM/unit columns remain separate.
    const descriptive=columns.map((column,index)=>index).filter(index=>index===description||index>description&&index<firstNumeric&&!columns[index].field);
    const rows=[columns.map(column=>column.text)];
    const body=words.filter(word=>center(word)>region.headerY1+1&&word.y0<region.dataY1+1);
    for(const line of wordsToLines(body)){
      const row=columns.map((column,index)=>line.words.filter(word=>inside(word,edges[index],edges[index+1])).map(word=>word.text).join(' '));
      row[description]=descriptive.map(index=>row[index]).filter(Boolean).join(' ');
      if(numeric.some(index=>row[index]))rows.push(row);
      else if(rows.length>1&&row[description]&&!/^produto[s]?$/i.test(normalize(row[description])))rows.at(-1)[description]+=' '+row[description];
    }
    if(rows.length>1)tables.push({rows,region,method:'aligned-budget-layout'});
  }
  return tables;
}
