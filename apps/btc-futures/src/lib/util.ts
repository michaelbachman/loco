
export type Ohlc = { time:number; open:number; high:number; low:number; close:number; volume?:number }
export function pct(a:number,b:number){ return ((a-b)/b)*100 }
export function floorToBoundary(ms:number, hours:number){
  const d=new Date(ms); const h=d.getUTCHours(); const bh=Math.floor(h/hours)*hours;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), bh,0,0,0);
}
export function closesInRange(startMs:number, endMs:number, hours:number){
  const out:number[]=[]; let cur=floorToBoundary(endMs,hours); if(cur>endMs) cur-=hours*3600*1000;
  while(cur>=startMs){ out.push(cur); cur-=hours*3600*1000 } return out.reverse();
}
export function nearestBarBefore(kl:Ohlc[], t:number): Ohlc | undefined {
  let lo=0, hi=kl.length-1, ans=-1; while(lo<=hi){const mid=(lo+hi)>>1; if(kl[mid].time<=t){ans=mid; lo=mid+1}else hi=mid-1}
  return ans>=0? kl[ans]: undefined
}
