import crypto from 'node:crypto';

const REDACTED='[REDACTED]';
const SENSITIVE_KEY=/password|otp|token|secret|authorization|cookie|api[-_]?key|credential|card|cvv|pan|paymentcredential/i;
const PRIVATE_LOCATION_KEY=/latitude|longitude|gps|location/i;

function safeValue(key,value){
  if(SENSITIVE_KEY.test(key)) return REDACTED;
  if(PRIVATE_LOCATION_KEY.test(key)) return REDACTED;
  if(typeof value==='string') return value.length>500?value.slice(0,500)+'…':value;
  return value;
}
function sanitize(input){
  if(input==null||typeof input!=='object') return input;
  if(Array.isArray(input)) return input.slice(0,20).map(v=>sanitize(v));
  return Object.fromEntries(Object.entries(input).slice(0,50).map(([k,v])=>[k,safeValue(k,typeof v==='object'?sanitize(v):v)]));
}
export function createObservability({repository}){
  const log=(level,event,fields={})=>{
    const payload={level,event,timestamp:new Date().toISOString(),...sanitize(fields)};
    const line=JSON.stringify(payload);
    if(level==='error') console.error(line); else console.log(line);
  };
  const track=async({name,eventKey,properties={}})=>{
    if(!name) return {recorded:false};
    try{return await repository.recordAnalyticsEvent({eventName:name,eventKey,properties});}
    catch(error){log('error','analytics_write_failed',{code:error?.code||'ANALYTICS_WRITE_FAILED'});return {recorded:false,error:true};}
  };
  return {log,track};
}
export function createRequestId(){return crypto.randomUUID();}
