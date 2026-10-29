import { normalizeTableImage,findTableRegions,matchTableWords } from './table-model.js';
export class BrowserTableAI {
  constructor(){this.worker=null;this.sequence=0;this.requests=new Map();}
  async predict(canvas,region){
    if(!this.worker){
      this.worker=new Worker('/table-ai.worker.js',{type:'module'});
      this.worker.onmessage=({data})=>{const request=this.requests.get(data.id);if(!request)return;this.requests.delete(data.id);if(data.error)request.reject(new Error(data.error));else request.resolve(data.result);};
      this.worker.onerror=()=>{for(const request of this.requests.values())request.reject(new Error('A IA não iniciou neste navegador. Atualize-o ou tente outro dispositivo.'));this.requests.clear();};
    }
    const width=Math.max(1,Math.round(region.x1-region.x0)),height=Math.max(1,Math.round(region.y1-region.y0)),ratio=488/Math.max(width,height);
    const resized=document.createElement('canvas');resized.width=Math.max(1,Math.floor(width*ratio));resized.height=Math.max(1,Math.floor(height*ratio));
    const context=resized.getContext('2d',{willReadFrequently:true});context.drawImage(canvas,region.x0,region.y0,width,height,0,0,resized.width,resized.height);
    const input=normalizeTableImage(context.getImageData(0,0,resized.width,resized.height).data,resized.width,resized.height);resized.width=resized.height=0;
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{this.requests.set(id,{resolve,reject});this.worker.postMessage({id,input,width,height},[input.buffer]);});
  }
  async analyze(canvas,words,onProgress=()=>{},options={}){
    let regions=findTableRegions(words,canvas.width,canvas.height,options);
    if(!regions.length)regions=[{x0:0,y0:0,x1:canvas.width,y1:canvas.height}];
    const tables=[];
    for(const [index,region]of regions.entries()){
      onProgress(`IA reconhecendo células e colunas: tabela ${index+1} de ${regions.length}…`);
      const prediction=await this.predict(canvas,region);
      if(prediction.confidence<.5 || !prediction.boxes.length)continue;
      tables.push({...matchTableWords(prediction,words,region),region});
    }
    return tables;
  }
  close(){this.worker?.terminate();this.worker=null;for(const request of this.requests.values())request.reject(new Error('Leitura interrompida.'));this.requests.clear();}
}
