// Entirely fictional document, drawn inside a browser; no customer images or identifiers.
export function budgetPhoto({width=776,format='png',rotation=0,inconsistent=false,origin=true,transparent=false}={}){
  const source=document.createElement('canvas');source.width=776;source.height=556;
  const draw=source.getContext('2d');
  if(!transparent){draw.fillStyle='#fff';draw.fillRect(0,0,776,556);}
  draw.fillStyle='#000';draw.strokeStyle='#000';draw.textBaseline='top';
  const text=(x,y,value,bold=false)=>{draw.font=`${bold?'bold 13':'12'}px Arial`;draw.textAlign='left';draw.fillText(value,x,y);};
  const right=(x,y,value,bold=false)=>{draw.font=`${bold?'bold 13':'12'}px Arial`;draw.textAlign='right';draw.fillText(value,x,y);};
  for(const y of [5,118,140,228,257,308]){draw.beginPath();draw.moveTo(7,y);draw.lineTo(763,y);draw.stroke();}
  text(12,35,'PECAS EXEMPLO',true);text(165,30,'Endereco: Rua Exemplo, 32',true);text(165,54,'Bairro: Centro',true);
  if(origin)text(165,78,'Origem: SC',true);
  text(500,24,'COMPONENTES',true);text(500,55,'AUTOMOTIVOS',true);
  text(7,122,'Emissao: 30/10/2026');text(230,122,'Orcamento n.: 100',true);
  text(7,150,'Cliente: EMPRESA DE TESTE',true);text(7,175,'Endereco: Avenida Exemplo, 695');
  text(7,197,'Cidade: Londrina - PR');text(7,213,'Veiculo: -');
  for(const [x,label]of [[9,'Codigo'],[60,'Descricao'],[415,'Marca'],[520,'QTDE.'],[574,'VLR. UNIT.'],[648,'VLR. ST'],[718,'TOTAL']])text(x,241,label,true);
  text(7,261,'PRODUTO');
  for(const [y,code,description,quantity,price,total]of [[280,'1001','ALAVANCA MODELO-A','1,00','180,25','180,25'],[295,'1002','ANEL MODELO-B','2,00','9,75','19,50']]){
    text(9,y,code);text(75,y,description);text(415,y,'EXEMPLO');
    for(const [x,value]of [[566,quantity],[632,price],[691,'0,00'],[761,total]])right(x,y,value);
  }
  const total=inconsistent?'299,75':'199,75';
  text(230,313,'Volumes: 3',true);text(530,313,'Valor Total Produtos:',true);right(761,313,total,true);
  for(const [y,label,value]of [[350,'(-)Desconto:','0,00'],[367,'(+)Taxa Financeira:','0,00'],[384,'(+)Taxa de Entrega:','0,00'],[401,'(+)ST:','0,00'],[418,'(=)Total Orcamento:',total]]){
    right(670,y,label,true);right(757,y,value);
  }
  text(7,438,'FORMA PAGAMENTO');text(181,438,'PARCELAMENTO');text(370,438,'VALOR');
  text(7,455,'Duplicata');text(184,455,'A VISTA');text(350,455,'R$'+total);
  text(7,476,'Vendedor',true);text(7,495,'VENDEDOR DE TESTE');text(7,519,'Obs: 43');
  const radians=rotation*Math.PI/180,scale=width/776,cos=Math.abs(Math.cos(radians)),sin=Math.abs(Math.sin(radians));
  const canvas=document.createElement('canvas');canvas.width=Math.ceil((776*cos+556*sin)*scale);canvas.height=Math.ceil((556*cos+776*sin)*scale);
  const context=canvas.getContext('2d');
  if(!transparent){context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);}
  context.translate(canvas.width/2,canvas.height/2);context.rotate(radians);context.scale(scale,scale);context.drawImage(source,-388,-278);
  return canvas.toDataURL('image/'+format,.9).split(',')[1];
}
