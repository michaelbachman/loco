
// Kraken Spot proxy
function getFetch(){ if(typeof fetch!=='undefined') return fetch; throw new Error('fetch unavailable in this runtime'); }
exports.handler=async (event)=>{
  try{
    const qs=event.queryStringParameters||{}, path=String(qs.path||'/0/public/Time'), raw=String(qs.qs||'')
    if(!path.startsWith('/0/public/')) return {statusCode:400, body:JSON.stringify({error:'Invalid path'})}
    const url=`https://api.kraken.com${path}${raw?(path.includes('?')?'&':'?')+raw:''}`
    const r=await getFetch()(url,{headers:{Accept:'application/json'}}); const text=await r.text()
    return {statusCode:r.status, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=3'}, body:text}
  }catch(e){ return {statusCode:502, body:JSON.stringify({error:String(e?.message||e)})}}
}
