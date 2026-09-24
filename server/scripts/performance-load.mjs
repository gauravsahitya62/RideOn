#!/usr/bin/env node
import process from 'node:process';

const baseUrl=String(process.env.PERF_BASE_URL||'').replace(/\/+$/,'');
const paths=String(process.env.PERF_PATHS||'/health,/api/v1/vehicles?limit=20').split(',').map(x=>x.trim()).filter(Boolean);
const concurrency=Math.max(1,Math.min(100,Number(process.env.PERF_CONCURRENCY)||10));
const durationMs=Math.max(1000,Math.min(120000,Number(process.env.PERF_DURATION_MS)||10000));
const token=String(process.env.PERF_AUTH_TOKEN||'').trim();

if(!baseUrl) throw new Error('PERF_BASE_URL is required.');
const url=new URL(baseUrl);
if(process.env.NODE_ENV==='production'||/production|render\.com$/i.test(url.hostname)){
  throw new Error('Refusing to run performance load against a production-looking host.');
}
if(!['http:','https:'].includes(url.protocol)) throw new Error('PERF_BASE_URL must use HTTP or HTTPS.');

const latencies=[];let errors=0,total=0;const started=Date.now();
async function worker(){
  while(Date.now()-started<durationMs){
    const path=paths[total%paths.length];
    const t=performance.now();
    try{
      const response=await fetch(new URL(path,url),{
        headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
      });
      const elapsed=performance.now()-t;
      latencies.push(elapsed);total++;
      if(!response.ok)errors++;
      await response.arrayBuffer();
    }catch{total++;errors++;}
  }
}
await Promise.all(Array.from({length:concurrency},()=>worker()));
latencies.sort((a,b)=>a-b);
const percentile=p=>latencies.length?latencies[Math.min(latencies.length-1,Math.floor((p/100)*latencies.length))]:null;
const seconds=(Date.now()-started)/1000;
const result={
  baseUrl:url.origin,
  paths,
  concurrency,
  durationSeconds:Number(seconds.toFixed(2)),
  requests:total,
  requestsPerSecond:Number((total/seconds).toFixed(2)),
  errors,
  errorRate:Number((errors/Math.max(1,total)).toFixed(4)),
  latencyMs:{
    p50:percentile(50)==null?null:Number(percentile(50).toFixed(2)),
    p95:percentile(95)==null?null:Number(percentile(95).toFixed(2)),
    p99:percentile(99)==null?null:Number(percentile(99).toFixed(2)),
  },
};
console.log(JSON.stringify(result,null,2));
if(errors>0) process.exitCode=2;
