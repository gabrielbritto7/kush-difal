import { parseNumber,round,STATES } from './calculator.js';

export const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function editDistance(a,b){
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next[j+1]=Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]===b[j]?0:1));row=next;}
  return row[b.length];
}
export function documentKind(text){
  const title=normalize(text).slice(0,2200);
  if(/\bdanfse\b|\bnfs\s*[-–]?\s*e\b|nota\s+fiscal\s+(?:eletronica\s+)?de\s+servicos/.test(title))return 'service_invoice';
  if(/\bdanfe\b|\bnf\s*[-–]?\s*e\b/.test(title))return 'goods_invoice';
  return 'budget';
}
export function fieldName(value){
  const text=normalize(value).replace(/r\s*\$/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  if(/^(?:ncm)(?: sh)?$/.test(text))return 'ncm';
  if(/\b(?:descricao|discriminacao|especificacao|description|mercadoria)\b/.test(text)||/^(produto|produtos|material|servico)$/.test(text))return 'description';
  if(/^(?:qtde|qtd|quant|quantidade|quantity|qte)(?: com| comercial| un)?$/.test(text))return 'quantity';
  if(/\b(?:unit|unitario|unitaria)\b/.test(text)&&/\b(?:v|vl|vlr|vr|valor|preco|price)\b/.test(text)||text==='unitario')return 'price';
  if(/\btotal\b/.test(text)&&!/(icms|ipi|tribut)/.test(text))return 'total';
  if(/^(?:v |vl |vlr |valor )?frete$/.test(text))return 'freight';
  if(/^(?:v |vl |vlr |valor )?(?:desc|desconto)$/.test(text))return 'discount';
  if(/^(?:outras despesas|despesas|seguro|v ipi|valor ipi)$/.test(text))return 'other';
  if(/\b(?:icms|st|ipi|cst|cfop|un|unid|unidade|codigo|cod)\b/.test(text))return 'ignore';
  // Repair short OCR headings only, never digits or item values. Row arithmetic must still agree.
  const compact=text.replace(/\s/g,'');
  if(compact.length>=3 && compact.length<=7 && compact.includes('d') && editDistance(compact,'qtde')<=2)return 'quantity';
  return null;
}
function valueOf(value){
  const text=String(value??'').replace(/\s/g,'').replace(/R\$/gi,'');
  if(!/^\d[\d.,]*$/.test(text))throw new Error('Valor numérico ilegível');
  const valueNumber=parseNumber(text);
  if(valueNumber<0 || valueNumber>1e12)throw new Error('Valor fora do limite');
  return valueNumber;
}
const moneyPattern=/\d[\d.]*,\d{2}\b|\d+\.\d{2}\b/g;

export function amountAfter(text,patterns){
  for(const line of text.split(/\r?\n/)){
    const normalized=normalize(line);
    for(const pattern of patterns){
      const match=normalized.match(pattern);if(!match)continue;
      const tail=line.slice(match.index+match[0].length),amounts=tail.match(moneyPattern);
      if(amounts?.length)try{return valueOf(amounts.at(-1));}catch{}
    }
  }
  return null;
}
function sum(items,selector){return round(items.reduce((total,item)=>total+selector(item),0));}
function allocate(items,key,total){
  if(total===null || !total || !items.length)return;
  const bases=items.map(item=>round(item.quantity*item.price)),base=bases.reduce((a,b)=>a+b,0);if(base<=0)return;
  const cents=Math.round(total*100);let used=0;
  const shares=bases.map((value,index)=>{const raw=cents*value/base,n=Math.floor(raw);used+=n;return {index,cents:n,remainder:raw-n};});
  for(const share of [...shares].sort((a,b)=>b.remainder-a.remainder).slice(0,cents-used))share.cents++;
  for(const share of shares)items[share.index][key]=round(items[share.index][key]+share.cents/100);
}
function stateIn(text,label){
  const explicit=normalize(text).match(new RegExp(`(?:^|\\n)\\s*(?:estado de )?${label}\\s*[:=-]\\s*([a-z]{2})\\b`));
  const value=explicit?.[1].toUpperCase();return STATES.includes(value)?value:null;
}
export function recognizeDocument(tables,text){
  const kind=documentKind(text);
  if(kind==='service_invoice'){
    const lines=text.split(/\r?\n/),index=lines.findIndex(line=>/descricao do servico/.test(normalize(line)));
    let amount=amountAfter(text,[/valor da operacao\s*\/\s*servico/,/valor liquido da nfs\s*-?\s*e/]);
    if(amount===null){
      const label=normalize(text).match(/valor da operacao\s*[/!|]\s*servico|valor total da nfs\s*-?\s*e/);
      const nearby=label?text.slice(label.index+label[0].length).split(/\r?\n/).slice(0,3).join(' '):'';
      const money=nearby.match(/R\$\s*(\d[\d.]*,\d{2})/);if(money)amount=valueOf(money[1]);
    }
    return {items:[],origin:null,destination:null,text,tables,documentType:kind,blocked:true,service:{description:index>=0?lines[index+1]?.trim()||'':'',amount},warnings:['Documento identificado como NFS-e de serviços (ISSQN). Esta calculadora trata DIFAL de ICMS sobre mercadorias: o valor desta nota não será importado como produto.'],verification:{complete:false,reason:'service_invoice'}};
  }
  const items=[],warnings=[],rejections=[];let detectedRows=0,mappedTables=0;
  for(const [tableIndex,table]of tables.entries()){
    const rows=table.rows||[];let columns=null,start=0;
    for(let first=0;first<Math.min(8,rows.length);first++){
      for(const depth of [1,2,3]){
        const headers=Array.from({length:Math.max(0,...rows.slice(first,first+depth).map(r=>r.length))},(_,column)=>[...new Set(rows.slice(first,first+depth).map(row=>row[column]||'').filter(Boolean))].join(' '));
        const fields=headers.map(fieldName);
        if(!fields.includes('description') || !fields.includes('quantity') || !fields.some(x=>x==='price'||x==='total'))continue;
        const map={};for(let index=0;index<fields.length;index++)if(fields[index] && fields[index]!=='ignore' && map[fields[index]]===undefined)map[fields[index]]=index;
        columns=map;start=first+depth;break;
      }
      if(columns)break;
    }
    if(!columns)continue;
    mappedTables++;
    // Some printed forms have shifted/misleading headings. Prefer a clearly textual product column
    // only when the labelled description contains mostly codes, never replace a plausible description.
    const body=rows.slice(start),dataRows=body.filter(row=>/\d/.test(row[columns.quantity]||'')&&/\d/.test(row[columns.price]||row[columns.total]||''));
    const descriptions=dataRows.map(r=>r[columns.description]||'').filter(Boolean);
    const letters=s=>(String(s).match(/[a-zA-ZÀ-ÿ]/g)||[]).length;
    if(descriptions.length && descriptions.filter(s=>letters(s)>3).length<descriptions.length*.4){
      const occupied=new Set(Object.values(columns));
      const candidates=Array.from({length:Math.max(...rows.map(r=>r.length))},(_,col)=>({col,values:dataRows.map(r=>r[col]||'').filter(s=>letters(s)>8 && s.length>14)})).filter(x=>!occupied.has(x.col));
      candidates.sort((a,b)=>b.values.length-a.values.length);
      if(candidates[0]?.values.length>=Math.max(1,descriptions.length*.5)){columns.description=candidates[0].col;warnings.push('O cabeçalho de descrição estava deslocado. A descrição foi recuperada da coluna com os nomes dos produtos; confira os itens.');}
    }
    for(const [offset,row]of body.entries()){
      const repaired={};
      let description=String(row[columns.description]??'').trim();
      for(const key of ['quantity','price','total']){
        const raw=String(row[columns[key]]??'').trim(),spill=raw.match(/^(.+\S)\s+(\d[\d.,]*)$/);
        if(spill && /[a-zA-ZÀ-ÿ]/.test(spill[1])){
          repaired[key]=spill[2];if(!description.includes(spill[1]))description+=' '+spill[1];
          warnings.push('Texto de uma descrição avançava sobre uma coluna numérica. Os campos foram separados e os totais das linhas foram conferidos.');
        }
      }
      const get=key=>repaired[key]??String(row[columns[key]]??'').trim();
      if(!description || /^(total|sub\s*total|valor total|volumes|forma pagamento)\b/.test(normalize(description)))continue;
      if(!/\d/.test(get('quantity')) && !/\d/.test(get('price')) && !/\d/.test(get('total')))continue;
      detectedRows++;
      try{
        const quantity=valueOf(get('quantity'));if(quantity<=0)throw new Error('Quantidade inválida');
        const total=get('total')?valueOf(get('total')):null;
        let price=get('price')?valueOf(get('price')):total!==null?total/quantity:NaN;
        if(!Number.isFinite(price))throw new Error('Preço não reconhecido');
        const freight=get('freight')?valueOf(get('freight')):0,other=get('other')?valueOf(get('other')):0,discount=get('discount')?valueOf(get('discount')):0;
        if(total!==null){
          const expected=round(quantity*price+freight+other-discount);
          if(Math.abs(expected-total)>.021)throw new Error('Total da linha não confere com quantidade e preço');
          if(expected!==round(total)){
            price=(total-freight-other+discount)/quantity;
            warnings.push('Há preço unitário impresso com arredondamento. O preço de cálculo preserva o total declarado na linha.');
          }
        }
        let ncm=get('ncm').replace(/[.\s]/g,'');if(ncm&&!/^\d{8}$/.test(ncm)){ncm='';warnings.push('NCM ilegível foi deixado em branco; nenhuma classificação foi inventada.');}
        items.push({description,ncm,quantity,price,freight,other,discount});
      }catch(error){rejections.push({table:tableIndex+1,row:start+offset+1,reason:error.message});}
    }
  }
  if(items.length>500)throw new Error('Limite de 500 produtos por documento. Divida o arquivo.');
  const products=sum(items,item=>round(item.quantity*item.price)),declaredProducts=amountAfter(text,[/valor total\s+(?:dos?\s+)?produtos/,/total\s+(?:dos?\s+)?produtos/,/valor\s+(?:dos?\s+)?produtos/]);
  const delivery=amountAfter(text,[/^\s*(?:\(\+\)\s*)?taxa\s+de\s+entrega/,/^\s*(?:\(\+\)\s*)?(?:valor\s+(?:do\s+)?)?frete\b/]);
  const discount=amountAfter(text,[/^\s*(?:\(-\)\s*)?desconto(?:\s+total)?\b/]);
  const declaredTotal=amountAfter(text,[/total\s+(?:do\s+)?orcamento/,/valor total\s+(?:da\s+)?nota/]);
  const productMatch=declaredProducts===null || Math.abs(products-declaredProducts)<=.021;
  if(productMatch && !rejections.length){
    if(!sum(items,item=>item.freight) && delivery){allocate(items,'freight',delivery);warnings.push('A taxa de entrega/frete foi identificada e rateada proporcionalmente entre os produtos.');}
    if(!sum(items,item=>item.discount) && discount){allocate(items,'discount',discount);warnings.push('O desconto global foi rateado proporcionalmente entre os produtos.');}
  }
  const base=sum(items,item=>round(item.quantity*item.price+item.freight+item.other-item.discount));
  const totalMatch=declaredTotal===null || Math.abs(base-declaredTotal)<=.021;
  if(!productMatch)warnings.push('A soma dos produtos reconhecidos difere do total de produtos do documento. A leitura automática está incompleta; não use o resultado sem conferir as linhas faltantes.');
  if(!totalMatch)warnings.push('O total calculado difere do total do documento. Há valores ou itens não reconhecidos; a leitura não foi considerada completa.');
  if(rejections.length)warnings.push(`${rejections.length} linha(s) foram rejeitadas por valores ilegíveis ou divergentes.`);
  if(!items.length)warnings.push('A IA não reconheceu produtos com quantidade e preço confiáveis neste documento. Não serão inventados itens ou valores.');
  if(items.some(item=>!item.ncm))warnings.push('O documento não informa NCM em todos os itens. Nenhum NCM ou alíquota foi deduzido pela IA.');
  let destination=stateIn(text,'destino');
  if(!destination){const match=normalize(text).match(/^\s*cidade\s*[:;]\s*[^\n]*?\s+(?:[-/]\s*)?([a-z]{2})\s*$/m);if(STATES.includes(match?.[1].toUpperCase()))destination=match[1].toUpperCase();}
  return {items,text,tables,documentType:kind,origin:stateIn(text,'origem'),destination,warnings:[...new Set(warnings)],verification:{complete:items.length>0 && productMatch && totalMatch && !rejections.length,detectedRows,recognizedRows:items.length,rejections,mappedTables,products,declaredProducts,delivery:delivery||0,discount:discount||0,base,declaredTotal}};
}
