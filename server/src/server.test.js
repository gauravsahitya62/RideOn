import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './server.js';
import { createServer } from 'node:http';

let server, base;
test.before(async()=>{ server=createServer(app); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); base=`http://127.0.0.1:${server.address().port}`; });
test.after(async()=>{ await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve())); });
test('health endpoint responds',async()=>{ const r=await fetch(`${base}/health`); assert.equal(r.status,200); assert.equal((await r.json()).status,'ok'); });
test('vehicle filters return category matches',async()=>{ const r=await fetch(`${base}/api/v1/vehicles?type=bike`); const j=await r.json(); assert.equal(r.status,200); assert.ok(j.data.length>0); assert.ok(j.data.every(v=>v.type==='bike')); });
test('quote rejects malformed payload',async()=>{ const r=await fetch(`${base}/api/v1/bookings/quote`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({vehicleId:'x'})}); assert.equal(r.status,400); });
test('booking validates customer fields',async()=>{ const r=await fetch(`${base}/api/v1/bookings`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({vehicleId:'creta-01'})}); assert.equal(r.status,400); });
