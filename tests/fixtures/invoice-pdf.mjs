// Fictional invoices generated in memory: no customer files, identifiers or expected answers are embedded.
function pdf(pages){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids=[];
  for(const content of pages){const page=objects.length+1,stream=page+1;kids.push(page+' 0 R');objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);}
  objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let value='%PDF-1.4\n';const offsets=[];
  for(const [index,object]of objects.entries()){offsets.push(Buffer.byteLength(value));value+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(value);value+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(value);
}
export function invoicePDF({combinedUnit=false,inconsistent=false,noteExtra=0}={}){
  const columns=combinedUnit?[20,60,235,280,305,335,395,450,500,530,575]:[20,60,235,280,305,335,355,395,450,500,530,575];
  const headers=combinedUnit?['CODIGO','DESCRICAO DO PRODUTO / SERVICO','NCM/SH','CST','CFOP','QTD / UN','VLR UNIT','VLR TOTAL','VLR DESC','ALIQ ICMS']:['CODIGO','DESCRICAO DO PRODUTO / SERVICO','NCM/SH','CST','CFOP','UN','QUANT','VALOR UNIT','VALOR TOTAL','VALOR DESC','ALIQ ICMS'];
  const pages=[];
  for(let index=0;index<2;index++){
    const commands=['0 G 0 g 0.5 w'];
    const text=(value,x,y,size=8)=>commands.push(`BT /F1 ${size} Tf ${x} ${y} Td (${value.replace(/[\\()]/g,'\\$&')}) Tj ET`);
    const line=(x0,y0,x1,y1)=>commands.push(`${x0} ${y0} m ${x1} ${y1} l S`);
    text('DANFE DE TESTE - SEM VALOR FISCAL',300,815,10);text('IDENTIFICACAO DO EMITENTE',20,800);text('Empresa Exemplo - Campinas - SP',20,785);
    if(!index){
      text('DESTINATARIO / REMETENTE',20,755);text('Cliente Exemplo - Curitiba - PR',20,740);
      text('CALCULO DO IMPOSTO',20,710);
      text('V. TOTAL PRODUTOS',20,685);text('VALOR DO FRETE',220,685);text('V. TOTAL DA NOTA',400,685);
      text(inconsistent?'300,00':'200,00',30,665);text('20,00',240,665);text(((inconsistent?320:220)+noteExtra).toFixed(2).replace('.',','),470,665);
    }
    text('DADOS DOS PRODUTOS / SERVICOS',20,590);
    const top=580,bottom=450;
    for(const x of columns)line(x,top,x,bottom);for(const y of [top,550,bottom])line(columns[0],y,columns.at(-1),y);
    headers.forEach((header,column)=>{
      const parts=header.startsWith('VALOR ')?['VALOR',header.slice(6)]:[header];
      parts.forEach((part,j)=>text(part,columns[column]+2,parts.length>1?569-j*12:557,5.5));
    });
    const qty=index?'2,0000':'1,0000',unitPrice=index?'50,0000':'100,0000';
    const values=combinedUnit?['ITEM'+index,'COMPONENTE INDUSTRIAL '+(index?'BETA':'ALFA'),'12345678','000','6102',qty,unitPrice,'100,00','0,00',index?'4,00':'12,00']:['ITEM'+index,'COMPONENTE INDUSTRIAL '+(index?'BETA':'ALFA'),'12345678','000','6102','UN',qty,unitPrice,'100,00','0,00',index?'4,00':'12,00'];
    values.forEach((value,column)=>text(value,columns[column]+2,533,6));
    text('DESCRICAO CONTINUADA EM OUTRA LINHA',columns[1]+2,515,6);text('REFERENCIA COMPLEMENTAR DO PRODUTO',columns[1]+2,497,6);
    if(combinedUnit)text('UN',columns[5]+2,515,6);
    text('DADOS ADICIONAIS',20,425);text('Documento ficticio apenas para testar o leitor.',20,410);
    pages.push(commands.join('\n'));
  }
  return pdf(pages);
}
