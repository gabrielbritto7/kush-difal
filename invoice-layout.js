import { wordsToLines,findTableRegions } from './table-model.js';
import { fieldName,normalize,numericText } from './recognized-document.js';

const number=/^\d[\d.,]*$/;
const money=/^\d[\d.]*,\d{2}$|^\d+\.\d{2}$/;
const center=word=>(word.y0+word.y1)/2;
const inside=(word,left,right)=>(word.x0+word.x1)/2>=left&&(word.x0+word.x1)/2<right;
function runs(values){
  const result=[];let start=null;
  for(let i=0;i<=values.length;i++){
    if(values[i]&&start===null)start=i;
    if(!values[i]&&start!==null){result.push({start,end:i-1,center:(start+i-1)/2});start=null;}
  }
  return result;
}

export function verticalRules(rgba,width,height,threshold=.72){
  const columns=new Uint8Array(width);
  for(let x=0;x<width;x++){
    let count=0,longest=0,run=0;
    for(let y=0;y<height;y++){
      const i=(y*width+x)*4,dark=rgba[i]<150&&rgba[i+1]<150&&rgba[i+2]<150;
      if(dark){count++;run++;longest=Math.max(longest,run);}else run=0;
    }
    columns[x]=count>=height*threshold&&longest>=height*.6?1:0;
  }
  return runs(columns).map(run=>run.center);
}

export function readRuledInvoiceTables(canvas,words){
  const tables=[];
  for(const region of findTableRegions(words,canvas.width,canvas.height,{invoice:true})){
    const top=Math.max(0,Math.ceil(region.headerY0)),height=Math.max(1,Math.ceil(region.firstDataY1-top));
    if(top>=canvas.height)continue;
    const pixels=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,top,canvas.width,Math.min(height,canvas.height-top));
    const columns=verticalRules(pixels.data,pixels.width,pixels.height);
    if(columns.length<5||columns.length>35)continue;
    const headerWords=words.filter(word=>center(word)>=region.headerY0-2&&center(word)<=region.headerY1+2);
    const headers=columns.slice(0,-1).map((left,index)=>wordsToLines(headerWords.filter(word=>inside(word,left,columns[index+1]))).map(line=>line.text).join(' '));
    const roles=headers.map(fieldName),quantity=roles.indexOf('quantity'),price=roles.indexOf('price'),total=roles.indexOf('total');
    if(!roles.includes('description')||quantity<0||price<0||total<0)continue;
    const body=words.filter(word=>center(word)>region.headerY1+2&&word.y0<region.y1),anchors=[];
    const quantityWords=body.filter(word=>inside(word,columns[quantity],columns[quantity+1])&&number.test(numericText(word.text)));
    const priceWords=body.filter(word=>inside(word,columns[price],columns[price+1])&&number.test(numericText(word.text)));
    const totalWords=body.filter(word=>inside(word,columns[total],columns[total+1])&&number.test(numericText(word.text)));
    for(const word of [...quantityWords,...priceWords,...totalWords].sort((a,b)=>a.y0-b.y0)){
      const y=center(word),height=word.y1-word.y0;
      if(anchors.some(anchor=>Math.abs(anchor.y-y)<height*.7))continue;
      const near=list=>list.some(other=>Math.abs(center(other)-y)<Math.max(height,other.y1-other.y0)*.7);
      if(!near(quantityWords)&&!(near(priceWords)&&near(totalWords)))continue;
      anchors.push({y,y0:word.y0,height});
    }
    anchors.sort((a,b)=>a.y-b.y);
    const rows=[headers];
    for(let index=0;index<anchors.length;index++){
      const y0=index===0?region.headerY1+2:anchors[index].y0-anchors[index].height*.45;
      const y1=index+1<anchors.length?anchors[index+1].y0-anchors[index+1].height*.45:region.y1;
      const row=columns.slice(0,-1).map((left,column)=>wordsToLines(body.filter(word=>center(word)>=y0&&center(word)<y1&&inside(word,left,columns[column+1]))).map(line=>line.text).join(' '));
      rows.push(row);
    }
    if(rows.length>1)tables.push({rows,region,method:'ruled-document-layout'});
  }
  return tables;
}

const labels={
  declaredProducts:/\b(?:valor|v\.?)\s*(?:total|tot\.?)\s*(?:dos?\s+)?produtos\b/,
  declaredTotal:/\b(?:valor|v\.?)\s*(?:total|tot\.?)\s*(?:da\s+)?nota\b/,
  delivery:/\b(?:valor|v\.?)\s*(?:do\s+)?frete\b/,
  insurance:/\b(?:valor|v\.?)\s*(?:do\s+)?seguro\b/,
  discount:/\bdesconto\b/,
  other:/\boutras\s+despesas(?:\s+acessorias)?\b/,
  ipi:/\b(?:valor|v\.?)\s*(?:total\s+)?(?:do\s+)?ipi\b/,
};
export function readInvoiceAmounts(words){
  const lines=wordsToLines(words),end=lines.find(line=>/dados.*produtos|descricao.*(?:qtd|quant)/.test(normalize(line.text)))?.y0??Infinity;
  const fields={};
  for(const line of lines.filter(line=>line.y0<end)){
    const raw=line.words.map(word=>word.text).join(' '),text=normalize(raw),offsets=[];let offset=0;
    for(const word of line.words){offsets.push(offset);offset+=word.text.length+1;}
    const generic=[...text.matchAll(/\b(?:valor|base|desconto|outras)\b|\bv\.(?=\s)|\bb\.(?=\s)/g)];
    for(const [key,pattern]of Object.entries(labels)){
      const match=text.match(pattern);if(!match)continue;
      const start=line.words.findIndex((word,index)=>offsets[index]+word.text.length>match.index);
      const next=generic.find(label=>label.index>=match.index+match[0].length);
      const nextIndex=next?offsets.findIndex(value=>value>=next.index):-1;
      const left=line.words[start].x0-3,right=nextIndex>=0?line.words[nextIndex].x0-2:Infinity;
      const candidates=words.filter(word=>money.test(numericText(word.text))&&inside(word,left,right)&&word.y0>=line.y0+line.height*.6&&word.y0<Math.min(end,line.y1+Math.max(35,line.height*5)));
      if(!candidates.length)continue;
      const nearest=Math.min(...candidates.map(word=>word.y0));
      const values=candidates.filter(word=>Math.abs(word.y0-nearest)<line.height*.5);
      if(values.length!==1)continue;
      const raw=numericText(values[0].text),value=Number(raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw);
      if(Number.isFinite(value)&&value>=0)fields[key]=value;
    }
  }
  return fields;
}
