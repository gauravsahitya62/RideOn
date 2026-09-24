import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservability } from './observability.js';

test('observability redacts secrets and private location fields before logging', async () => {
  const lines=[];
  const oldLog=console.log;
  const oldError=console.error;
  console.log=(line)=>lines.push(line);
  console.error=(line)=>lines.push(line);
  try{
    const service=createObservability({repository:{recordAnalyticsEvent:async()=>({recorded:true})}});
    service.log('info','qa_event',{password:'secret',otp:'123456',accessToken:'bearer',latitude:26.9,longitude:75.8,bookingId:'booking-1',safe:'ok'});
  }finally{
    console.log=oldLog; console.error=oldError;
  }
  const output=JSON.parse(lines[0]);
  assert.equal(output.password,'[REDACTED]');
  assert.equal(output.otp,'[REDACTED]');
  assert.equal(output.accessToken,'[REDACTED]');
  assert.equal(output.latitude,'[REDACTED]');
  assert.equal(output.longitude,'[REDACTED]');
  assert.equal(output.safe,'ok');
});

test('analytics tracking is delegated to the authoritative repository ledger', async () => {
  const calls=[];
  const service=createObservability({repository:{recordAnalyticsEvent:async event=>{calls.push(event);return {recorded:true};}}});
  const result=await service.track({name:'booking_created',eventKey:'booking:1',bookingId:'1',properties:{delivery:true}});
  assert.equal(result.recorded,true);
  assert.equal(calls[0].eventName,'booking_created');
  assert.equal(calls[0].eventKey,'booking:1');
});
