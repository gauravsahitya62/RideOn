const ROUTE_CACHE_TTL_MS = Math.max(30_000, Number(process.env.ROUTE_CACHE_TTL_MS || 120_000));
const ROUTE_TIMEOUT_MS = Math.max(2_000, Number(process.env.ROUTE_TIMEOUT_MS || 8_000));
const cache = new Map();

function validatePoint(point) {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

function key(a,b){
  return [a.latitude,a.longitude,b.latitude,b.longitude].map(v=>v.toFixed(5)).join(',');
}

function readCache(k){
  const hit=cache.get(k);
  if(!hit) return null;
  if(hit.expiresAt <= Date.now()){ cache.delete(k); return null; }
  return hit.value;
}
function writeCache(k,value){
  cache.set(k,{value,expiresAt:Date.now()+ROUTE_CACHE_TTL_MS});
  if(cache.size>250){
    const oldest=cache.keys().next().value;
    if(oldest) cache.delete(oldest);
  }
}

export async function getDrivingRoute(originInput,destinationInput){
  const origin=validatePoint(originInput);
  const destination=validatePoint(destinationInput);
  if(!origin || !destination){
    const e=new Error('Invalid route coordinates.'); e.code='ROUTE_INVALID_COORDINATES'; throw e;
  }
  const cached=readCache(key(origin,destination));
  if(cached) return {...cached,cached:true};

  const apiKey=String(process.env.GOOGLE_ROUTES_API_KEY||'').trim();
  if(!apiKey){
    const e=new Error('Routing provider is not configured.'); e.code='ROUTE_PROVIDER_NOT_CONFIGURED'; throw e;
  }

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ROUTE_TIMEOUT_MS);
  try{
    const response=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{
      method:'POST',
      signal:controller.signal,
      headers:{
        'Content-Type':'application/json',
        'X-Goog-Api-Key':apiKey,
        'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.staticDuration',
      },
      body:JSON.stringify({
        origin:{location:{latLng:{latitude:origin.latitude,longitude:origin.longitude}}},
        destination:{location:{latLng:{latitude:destination.latitude,longitude:destination.longitude}}},
        travelMode:'DRIVE',
        routingPreference:'TRAFFIC_AWARE',
        units:'METRIC',
      }),
    });
    if(!response.ok){
      const e=new Error('Routing provider unavailable.'); e.code='ROUTE_PROVIDER_UNAVAILABLE'; throw e;
    }
    const payload=await response.json().catch(()=>null);
    const route=payload?.routes?.[0];
    if(!route?.distanceMeters || !route?.duration){
      const e=new Error('No driving route found for these locations.'); e.code='ROUTE_NOT_FOUND'; throw e;
    }
    const durationSeconds=Math.max(0,Math.round(Number(route.duration.endsWith?.('s') ? route.duration.slice(0,-1) : route.duration)));
    const result={
      distanceMeters:Number(route.distanceMeters),
      durationSeconds,
      staticDurationSeconds:route.staticDuration ? Math.max(0,Math.round(Number(String(route.staticDuration).replace(/s$/,'')))) : null,
      provider:'google_routes',
    };
    writeCache(key(origin,destination),result);
    return result;
  }catch(error){
    if(error?.name==='AbortError'){ const e=new Error('Routing request timed out.'); e.code='ROUTE_PROVIDER_TIMEOUT'; throw e; }
    if(error?.code?.startsWith('ROUTE_')) throw error;
    const e=new Error('Routing provider unavailable.'); e.code='ROUTE_PROVIDER_UNAVAILABLE'; throw e;
  }finally{clearTimeout(timer);}
}
