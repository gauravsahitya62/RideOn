const SENSITIVE=/password|otp|token|secret|authorization|cookie|api[-_]?key|credential|card|cvv|pan|paymentcredential/i;
const LOCATION=/latitude|longitude|gps|location/i;
const sanitize=(value,key='')=>{
  if(SENSITIVE.test(key)||LOCATION.test(key)) return '[REDACTED]';
  if(value&&typeof value==='object'){
    if(Array.isArray(value)) return value.slice(0,10).map(v=>sanitize(v));
    return Object.fromEntries(Object.entries(value).slice(0,30).map(([k,v])=>[k,sanitize(v,k)]));
  }
  return typeof value==='string'&&value.length>300?value.slice(0,300)+'…':value;
};
export function reportClientEvent(event,fields={}) {
  // Integration point for a future crash/telemetry provider. No third-party
  // secret or remote analytics endpoint is embedded in the mobile binary.
  if(typeof console!=='undefined'&&console.info) console.info('[RideOnObservability]',JSON.stringify({event,timestamp:new Date().toISOString(),...sanitize(fields)}));
}
export function reportClientError(error,context={}) {
  reportClientEvent('client_error',{name:error?.name||'Error',message:error?.message||'Unexpected client error',code:error?.code||null,...context});
}
