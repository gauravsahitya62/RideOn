const GEOCODE_CACHE_TTL_MS = Math.max(60_000, Number(process.env.GEOCODE_CACHE_TTL_MS || 600_000));
const GEOCODE_TIMEOUT_MS = Math.max(2_000, Number(process.env.GEOCODE_TIMEOUT_MS || 8_000));
const cache = new Map();

function normalize(value){return String(value||'').trim().replace(/\s+/g,' ').toLowerCase();}
function read(k){const hit=cache.get(k);if(!hit)return null;if(hit.expiresAt<=Date.now()){cache.delete(k);return null;}return hit.value;}
function write(k,value){cache.set(k,{value,expiresAt:Date.now()+GEOCODE_CACHE_TTL_MS});if(cache.size>250){const oldest=cache.keys().next().value;if(oldest)cache.delete(oldest);}}

export async function geocodeAddress(address,city){
  const rawAddress=String(address||'').trim();
  const rawCity=String(city||'').trim();
  if(rawAddress.length<4){const e=new Error('Address is too short.');e.code='GEOCODE_INVALID_QUERY';throw e;}
  const k=normalize(rawAddress+'|'+rawCity);
  const cached=read(k); if(cached)return {...cached,cached:true};
  const apiKey=String(process.env.GOOGLE_GEOCODING_API_KEY||process.env.GOOGLE_MAPS_SERVER_API_KEY||process.env.GOOGLE_MAPS_API_KEY||'').trim();
  if(!apiKey){const e=new Error('Address search is not configured.');e.code='GEOCODE_PROVIDER_NOT_CONFIGURED';throw e;}
  const q=rawCity ? `${rawAddress}, ${rawCity}, India` : `${rawAddress}, India`;
  const url='https://maps.googleapis.com/maps/api/geocode/json?'+new URLSearchParams({address:q,key:apiKey,language:'en',region:'in'}).toString();
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),GEOCODE_TIMEOUT_MS);
  try{
    const response=await fetch(url,{signal:controller.signal});
    if(!response.ok){const e=new Error('Geocoding provider unavailable.');e.code='GEOCODE_PROVIDER_UNAVAILABLE';throw e;}
    const payload=await response.json().catch(()=>null);
    if(payload?.status==='ZERO_RESULTS'){const e=new Error('No address match found.');e.code='GEOCODE_NOT_FOUND';throw e;}
    if(payload?.status!=='OK'){const e=new Error('Geocoding provider unavailable.');e.code='GEOCODE_PROVIDER_UNAVAILABLE';throw e;}
    const first=payload.results?.[0];
    const lat=Number(first?.geometry?.location?.lat),lng=Number(first?.geometry?.location?.lng);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)){const e=new Error('No usable location found.');e.code='GEOCODE_NOT_FOUND';throw e;}
    const value={location:{latitude:lat,longitude:lng},formattedAddress:String(first.formatted_address||rawAddress),provider:'google_geocoding'};
    write(k,value);return value;
  }catch(error){
    if(error?.name==='AbortError'){const e=new Error('Address search timed out.');e.code='GEOCODE_PROVIDER_TIMEOUT';throw e;}
    if(String(error?.code||'').startsWith('GEOCODE_'))throw error;
    const e=new Error('Geocoding provider unavailable.');e.code='GEOCODE_PROVIDER_UNAVAILABLE';throw e;
  }finally{clearTimeout(timer);}
}
