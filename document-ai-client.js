export function serviceURL(value) {
  const url=new URL(value || '/api/documents', location.origin);
  if(url.username || url.password || url.search || url.hash)throw new Error('Use apenas o endereço do serviço, sem senha, parâmetros ou fragmentos.');
  if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('O serviço de IA deve usar HTTPS (HTTP só é permitido para testes em localhost).');
  let path=url.pathname.replace(/\/+$/,'');
  if(!path.endsWith('/api/documents'))path+='/api/documents';
  url.pathname=path;
  return url.href;
}
async function readJSON(response) {
  let result;
  try{result=await response.json();}catch{throw new Error('O serviço de IA não respondeu como esperado. Confira o endereço e a instalação do backend Docling.');}
  if(!response.ok)throw new Error(result.error || 'O serviço de IA não concluiu a leitura.');
  return result;
}
export async function aiStatus(url) {
  return await readJSON(await fetch(serviceURL(url)+'/status',{signal:AbortSignal.timeout(10000)}));
}
export async function readWithAI(file,url,onProgress=()=>{}) {
  const mime={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'}[file.name.split('.').pop().toLowerCase()];
  if(!mime || !file.size || file.size>5*1024*1024)throw new Error('Use PDF, PNG, JPEG ou WebP de até 5 MB.');
  onProgress('Analisando a estrutura e as tabelas com IA. A primeira leitura pode demorar enquanto os modelos carregam.');
  const parsed=await readJSON(await fetch(serviceURL(url)+'/extract',{method:'POST',headers:{'Content-Type':mime},body:file,signal:AbortSignal.timeout(300000)}));
  if(parsed.method!=='docling' || !Array.isArray(parsed.items) || typeof parsed.text!=='string')throw new Error('O serviço não retornou uma leitura válida do Docling.');
  return parsed;
}
