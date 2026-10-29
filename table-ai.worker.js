import { TABLE_MODEL, decodeTableModel } from './table-model.js';
let runtime,session;
async function load(){
  if(session)return session;
  const ort=await import('/vendor/ort/ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths=new URL('/vendor/ort/',self.location.href).href;
  ort.env.wasm.numThreads=1;ort.env.logLevel='error';
  const response=await fetch(TABLE_MODEL.file);if(!response.ok)throw new Error('Não foi possível carregar a IA. Confira os arquivos do deploy.');
  const bytes=await response.arrayBuffer();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==TABLE_MODEL.size || hash!==TABLE_MODEL.sha256)throw new Error('O arquivo do modelo está incompleto ou alterado. Refaça o deploy.');
  runtime=ort;session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all',logSeverityLevel:3});return session;
}
self.onmessage=async({data})=>{
  try{
    await load();
    const outputs=await session.run({x:new runtime.Tensor('float32',data.input,[1,3,488,488])});
    const values=Object.values(outputs),locations=values.find(v=>v.dims[2]===8),probabilities=values.find(v=>v.dims[2]===50);
    if(!locations||!probabilities)throw new Error('Saída do modelo de IA incompatível.');
    const result=decodeTableModel(locations,probabilities,data.width,data.height);
    for(const value of values)value.dispose();
    self.postMessage({id:data.id,result});
  }catch(error){self.postMessage({id:data.id,error:error.message||'A IA não conseguiu analisar esta tabela.'});}
};
