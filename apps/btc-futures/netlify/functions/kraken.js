
// Kraken Futures proxy
async function getFetch(){ if(typeof fetch!=='undefined') return fetch; const {fetch:uf}=await import('undici'); return uf }
exports.handler=async (event)=>{
  try{
    const qs=event.queryStringParameters||{}, path=String(qs.path||'/derivatives/api/v3/tickers'), raw=String(qs.qs||'')
    if(!path.startsWith('/derivatives/api/')) return {statusCode:400, body:JSON.stringify({error:'Invalid path'})}
    const url=`https://futures.kraken.com${path}${raw?(path.includes('?')?'&':'?')+raw:''}`
    const r=await (await getFetch())(url,{headers:{Accept:'application/json'}}); const text=await r.text()
    return {statusCode:r.status, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=3'}, body:text}
  }catch(e){ return {statusCode:502, body:JSON.stringify({error:String(e?.message||e)})}}
}
