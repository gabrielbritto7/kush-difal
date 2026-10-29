// SLANet-plus decoding and preprocessing adapted from RapidAI/RapidTable (Apache-2.0).
// Model predictions identify structure only; recognized text is assigned separately.
export const TABLE_MODEL = {
  file:'/assets/models/table.onnx', size:7745801,
  sha256:'f1e8ae984d531e447bf2be66bf25ca318a12250ff06f88de9155bdcaaa95e117',
};
export const TABLE_TOKENS=['sos','<thead>','</thead>','<tbody>','</tbody>','<tr>','</tr>','<td','>','</td>',
  ...Array.from({length:19},(_,i)=>` colspan="${i+2}"`),
  ...Array.from({length:19},(_,i)=>` rowspan="${i+2}"`),'<td></td>','eos'];

export function normalizeTableImage(rgba,width,height,size=488) {
  const data=new Float32Array(3*size*size),plane=size*size;
  const mean=[.485,.456,.406],std=[.229,.224,.225];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
    // Paddle's reference pipeline loads BGR; padding is zero after normalization.
    data[c*plane+y*size+x]=(rgba[(y*width+x)*4+2-c]/255-mean[c])/std[c];
  }
  return data;
}

export function decodeTableModel(locations,probabilities,width,height) {
  const steps=probabilities.dims[1],vocabulary=probabilities.dims[2],tags=[],boxes=[],scores=[];
  if(vocabulary!==TABLE_TOKENS.length || locations.dims[2]!==8)throw new Error('Modelo de tabelas incompatível.');
  for(let step=0;step<steps;step++){
    let best=0,score=-Infinity;
    for(let k=0;k<vocabulary;k++){const p=probabilities.data[step*vocabulary+k];if(p>score){score=p;best=k;}}
    const token=TABLE_TOKENS[best];
    if(token==='eos')break;
    if(token==='sos')continue;
    tags.push(token);scores.push(score);
    if(token==='<td' || token==='<td></td>'){
      const polygon=Array.from(locations.data.slice(step*8,step*8+8),value=>value*Math.max(width,height));
      boxes.push([Math.min(...polygon.filter((_,i)=>i%2===0)),Math.min(...polygon.filter((_,i)=>i%2===1)),Math.max(...polygon.filter((_,i)=>i%2===0)),Math.max(...polygon.filter((_,i)=>i%2===1))]);
    }
  }
  return {tags,boxes,confidence:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0};
}

export function cellStructure(tags) {
  // Parse only the fixed model vocabulary. No document text is interpreted as HTML.
  const result=[];let row=-1,column=0,index=0;const occupied=new Set();
  for(let i=0;i<tags.length;i++){
    if(tags[i]==='<tr>'){row++;column=0;}
    if(tags[i]!=='<td' && tags[i]!=='<td></td>')continue;
    let colspan=1,rowspan=1;
    if(tags[i]==='<td')for(let j=i+1;j<tags.length && tags[j]!=='>';j++){
      const col=tags[j].match(/^ colspan="(\d+)"$/),r=tags[j].match(/^ rowspan="(\d+)"$/);
      if(col)colspan=Number(col[1]);if(r)rowspan=Number(r[1]);
    }
    while(occupied.has(`${row}:${column}`))column++;
    result.push({index:index++,row:Math.max(0,row),column,colspan,rowspan});
    for(let r=Math.max(0,row);r<row+rowspan;r++)for(let c=column;c<column+colspan;c++)occupied.add(`${r}:${c}`);
    column+=colspan;
  }
  return result;
}

export function wordsToLines(words) {
  const lines=[];
  for(const word of [...words].sort((a,b)=>a.y0-b.y0 || a.x0-b.x0)){
    const center=(word.y0+word.y1)/2,height=word.y1-word.y0;
    let line=lines.find(line=>Math.abs(line.center-center)<Math.max(3,Math.min(line.height,height)*.55));
    if(!line){line={center,height,words:[],y0:word.y0,y1:word.y1};lines.push(line);}
    line.words.push(word);line.y0=Math.min(line.y0,word.y0);line.y1=Math.max(line.y1,word.y1);
  }
  return lines.sort((a,b)=>a.center-b.center).map(line=>({...line,words:line.words.sort((a,b)=>a.x0-b.x0),text:line.words.sort((a,b)=>a.x0-b.x0).map(w=>w.text).join(' ')}));
}

export function findTableRegions(words,width,height) {
  const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const lines=wordsToLines(words),regions=[];
  for(let i=0;i<lines.length;i++){
    const header=normalize(lines[i].text);
    const quantity=/\b(qtde|qtd|quantidade|quant|quantity)\b/.test(header);
    const productHeading=/descri|produto|discrim|material/.test(header);
    if((!quantity && !(productHeading&&/total/.test(header))) || !/unit|preco|price|valor|vlr/.test(header))continue;
    let bottom=lines[i].y1,last=i,rows=0;const selected=[...lines[i].words];
    for(let j=i+1;j<Math.min(lines.length,i+150);j++){
      const text=normalize(lines[j].text);
      if(/(?:valor\s+total\s+(?:dos?\s+)?produtos|total\s+(?:dos?\s+)?produtos|sub\s*total|forma\s*(?:de\s*)?pagamento|base\s+de\s+calculo|calculo\s+do\s+imposto)/.test(text))break;
      if(rows && lines[j].y0-bottom>Math.max(28,lines[i].height*3.5))break;
      const amounts=lines[j].text.match(/\d[\d.]*[,\.]\d{2,4}\b/g)||[];
      if(amounts.length>=2){rows++;bottom=lines[j].y1;last=j;selected.push(...lines[j].words);}
      else if(!rows || lines[j].y0-bottom<lines[i].height*1.8){selected.push(...lines[j].words);}
      else break;
    }
    if(!rows)continue;
    const padding=Math.max(5,lines[i].height*.65);
    regions.push({x0:Math.max(0,Math.min(...selected.map(w=>w.x0))-padding),y0:Math.max(0,lines[i].y0-padding),x1:Math.min(width,Math.max(...selected.map(w=>w.x1))+padding),y1:Math.min(height,bottom+padding)});
    i=last;
  }
  return regions;
}

export function matchTableWords(prediction,words,region) {
  const cells=cellStructure(prediction.tags),assigned=prediction.boxes.map(()=>[]);
  for(const word of words){
    const x0=word.x0-region.x0,y0=word.y0-region.y0,x1=word.x1-region.x0,y1=word.y1-region.y0,area=Math.max(1,(x1-x0)*(y1-y0));
    let best=-1,score=0;
    prediction.boxes.forEach((box,index)=>{
      const intersection=Math.max(0,Math.min(x1,box[2])-Math.max(x0,box[0]))*Math.max(0,Math.min(y1,box[3])-Math.max(y0,box[1]));
      const value=intersection/area;
      if(value>score){score=value;best=index;}
    });
    if(best>=0 && score>.2)assigned[best].push(word);
  }
  const rows=[];
  for(const cell of cells){
    const text=wordsToLines(assigned[cell.index]||[]).map(l=>l.text).join(' ');
    for(let r=cell.row;r<cell.row+cell.rowspan;r++){
      rows[r]??=[];
      for(let c=cell.column;c<cell.column+cell.colspan;c++)rows[r][c]=text;
    }
  }
  const width=Math.max(0,...rows.map(row=>row.length));
  return {rows:rows.map(row=>Array.from({length:width},(_,i)=>row[i]||'')),confidence:prediction.confidence};
}
