import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { AnimatedRegion, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { rideOnApi } from '../services/api';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',white:'#FFFFFF',line:'#E8EAF0',blue:'#287AF7',green:'#16845B',red:'#B23B3B'};
const DEFAULT={latitude:26.9124,longitude:75.7873,latitudeDelta:.08,longitudeDelta:.08};

function decodePolyline(encoded){
  if(!encoded)return [];
  const points=[];let index=0,lat=0,lng=0;
  while(index<encoded.length){
    let shift=0,result=0,b;
    do{b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);
    lat+=result&1?~(result>>1):result>>1;shift=0;result=0;
    do{b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);
    lng+=result&1?~(result>>1):result>>1;
    points.push({latitude:lat/1e5,longitude:lng/1e5});
  }
  return points;
}

function relativeTime(value){
  if(!value)return 'No location received yet';
  const seconds=Math.max(0,Math.round((Date.now()-new Date(value).getTime())/1000));
  if(seconds<10)return 'just now';
  if(seconds<60)return `${seconds}s ago`;
  return `${Math.round(seconds/60)} min ago`;
}

export default function LiveDeliveryMap({booking,onDelivered}){
  const [tracking,setTracking]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const socketRef=useRef(null);
  const markerRef=useRef(null);
  const [tick,setTick]=useState(0);
  const coordinateRef=useRef(new AnimatedRegion(DEFAULT));
  const [connectionAttempt,setConnectionAttempt]=useState(0);

  const load=useCallback(async()=>{
    if(!booking?.id)return;
    setLoading(true);setError('');
    try{
      const result=await rideOnApi.getTracking(booking.id);
      setTracking(result?.tracking||null);
    }catch(e){setError(e?.message||'We could not load live delivery tracking right now.');}
    finally{setLoading(false);}
  },[booking?.id]);

  useEffect(()=>{load();},[load]);

  useEffect(()=>{
    if(!booking?.id||tracking?.session?.status!=='active'||tracking?.booking?.deliveryStatus!=='in_delivery')return;
    let socket;
    try{
      socket=rideOnApi.createTrackingSocket(booking.id,{
        onMessage:event=>{
          try{
            const message=JSON.parse(event.data);
            if(message.type==='tracking.snapshot'||message.type==='tracking.update'){
              setTracking(current=>({...current,active:true,stale:false,session:message.tracking?.session||current?.session,booking:message.tracking?.booking||current?.booking,location:message.tracking?.location||current?.location,route:message.tracking?.routeUnavailable?null:(message.tracking?.route||current?.route),routeUnavailable:Boolean(message.tracking?.routeUnavailable)}));
            }else if(message.type==='tracking.completed'||message.type==='tracking.stopped'){
              setTracking(current=>({...current,active:false,stale:false,session:message.tracking?.session||current?.session,booking:message.tracking?.booking||current?.booking}));
              onDelivered?.();
            }
          }catch{}
        },
        onClose:()=>{setTracking(current=>current?.active?{...current,stale:true,connectionLost:true}:current);setTimeout(()=>setConnectionAttempt(value=>value+1),10000);},
        onError:()=>setError('Live connection was interrupted. Reopen this trip to reconnect.'),
      });
      socketRef.current=socket;
    }catch(e){setError('Live tracking could not connect right now.');}
    return()=>{try{socket?.close();}catch{}socketRef.current=null;};
  },[booking?.id,tracking?.active,connectionAttempt,onDelivered]);

  useEffect(()=>{const timer=setInterval(()=>setTick(x=>x+1),15000);return()=>clearInterval(timer);},[]);

  const current=tracking?.location|| (tracking?.session?.lastLatitude!=null?{latitude:tracking.session.lastLatitude,longitude:tracking.session.lastLongitude,updatedAt:tracking.session.lastLocationAt}:null);
  const destination=booking?.deliveryLatitude!=null&&booking?.deliveryLongitude!=null?{latitude:Number(booking.deliveryLatitude),longitude:Number(booking.deliveryLongitude)}:null;
  const polyline=useMemo(()=>tracking?.routeUnavailable?[]:decodePolyline(tracking?.session?.lastRoutePolyline||tracking?.route?.encodedPolyline),[tracking?.routeUnavailable,tracking?.session?.lastRoutePolyline,tracking?.route?.encodedPolyline]);
  const region=useMemo(()=>{
    const points=[current,destination,...polyline].filter(Boolean);if(!points.length)return DEFAULT;
    const lats=points.map(p=>p.latitude),lons=points.map(p=>p.longitude);
    return {latitude:(Math.min(...lats)+Math.max(...lats))/2,longitude:(Math.min(...lons)+Math.max(...lons))/2,latitudeDelta:Math.max(.025,Math.min(.5,(Math.max(...lats)-Math.min(...lats))*.9+.025)),longitudeDelta:Math.max(.025,Math.min(.5,(Math.max(...lons)-Math.min(...lons))*.9+.025))};
  },[current,destination,polyline]);

  useEffect(()=>{
    if(!current||!markerRef.current)return;
    try{
      if(markerRef.current.__rideOnCoordinate)markerRef.current.__rideOnCoordinate.timing({latitude:current.latitude,longitude:current.longitude,duration:900,useNativeDriver:false}).start();
    }catch{}
  },[current?.latitude,current?.longitude]);

  if(loading)return <View style={styles.state}><ActivityIndicator color={C.orange}/><Text style={styles.muted}>Connecting to live delivery…</Text></View>;
  if(error&&!tracking)return <View style={styles.state}><Text style={styles.errorTitle}>Live delivery unavailable</Text><Text style={styles.muted}>{error}</Text><TouchableOpacity style={styles.retry} onPress={load}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View>;
  if(!tracking||tracking.booking?.deliveryStatus!=='in_delivery')return <View style={styles.state}><Text style={styles.delivered}>✓</Text><Text style={styles.title}>Vehicle delivered</Text><Text style={styles.muted}>Live tracking has stopped for this delivery.</Text></View>;

  const stale=Boolean(tracking.stale||tracking.connectionLost||!current||Date.now()-(new Date(current.updatedAt||tracking.session?.lastLocationAt||0).getTime())>Math.max(30,tracking.staleThresholdSeconds||90)*1000);
  const coordinate=coordinateRef.current;
  const distance=tracking?.routeUnavailable?null:(tracking?.route?.distanceMeters??tracking?.session?.lastRouteDistanceMeters);
  const duration=tracking?.routeUnavailable?null:(tracking?.route?.durationSeconds??tracking?.session?.lastRouteDurationSeconds);
  const eta=duration!=null?Math.max(1,Math.round(Number(duration)/60)):null;
  return <View style={styles.card}>
    <View style={styles.header}><View style={{flex:1}}><Text style={styles.kicker}>LIVE DELIVERY</Text><Text style={styles.title}>{stale?'Live location temporarily unavailable':'Your vehicle is on the way'}</Text></View><View style={[styles.livePill,stale&&styles.stalePill]}><View style={[styles.dot,stale&&styles.staleDot]}/><Text style={[styles.liveText,stale&&styles.staleText]}>{stale?'STALE':'LIVE'}</Text></View></View>
    <View style={styles.mapWrap}><MapView provider={PROVIDER_GOOGLE} style={StyleSheet.absoluteFill} initialRegion={region} region={region}>
      {polyline.length>1&&<Polyline coordinates={polyline} strokeWidth={5} strokeColor={C.orange}/>}
      {destination&&<Marker coordinate={destination}><View style={styles.homePin}><Text style={styles.homeText}>⌂</Text></View></Marker>}
      {current&&<Marker.Animated ref={ref=>{markerRef.current=ref;markerRef.current.__rideOnCoordinate=coordinate;}} coordinate={coordinate}><View style={styles.carPin}><Text style={styles.carText}>🚗</Text></View></Marker.Animated>}
    </MapView></View>
    <View style={styles.metrics}>
      <View style={styles.metric}><Text style={styles.metricValue}>{distance!=null?(Number(distance)/1000).toFixed(1)+' km':'—'}</Text><Text style={styles.metricLabel}>remaining distance</Text></View>
      <View style={styles.metric}><Text style={styles.metricValue}>{eta!=null?eta+' min':'—'}</Text><Text style={styles.metricLabel}>estimated arrival</Text></View>
    </View>
    <Text style={styles.estimate}>Estimated delivery time · {stale?'Waiting for a fresh location':tracking?.routeUnavailable?'Route refresh temporarily unavailable':'updates as the vehicle moves'}</Text>
    <Text style={styles.updated}>{stale?'Location was last updated '+relativeTime(current?.updatedAt||tracking.session?.lastLocationAt)+'.': 'Location updated '+relativeTime(current?.updatedAt||tracking.session?.lastLocationAt)+'.'}</Text>
    {error?<Text style={styles.error}>{error}</Text>:null}
  </View>;
}

const styles=StyleSheet.create({card:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:20,padding:14,marginBottom:14},header:{flexDirection:'row',alignItems:'center',gap:10,marginBottom:12},kicker:{fontSize:9,fontWeight:'900',letterSpacing:1.5,color:C.orange},title:{fontSize:16,fontWeight:'900',color:C.ink,marginTop:2},livePill:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:'#E9F7F0',borderRadius:20,paddingHorizontal:9,paddingVertical:6},stalePill:{backgroundColor:'#FFF2E9'},dot:{width:7,height:7,borderRadius:4,backgroundColor:C.green},staleDot:{backgroundColor:C.orange},liveText:{fontSize:9,fontWeight:'900',color:C.green},staleText:{color:C.orange},mapWrap:{height:260,borderRadius:16,overflow:'hidden',backgroundColor:'#E8EDF3'},carPin:{width:42,height:42,borderRadius:21,backgroundColor:C.orange,borderWidth:3,borderColor:C.white,alignItems:'center',justifyContent:'center'},carText:{fontSize:20},homePin:{width:34,height:34,borderRadius:17,backgroundColor:C.ink,borderWidth:3,borderColor:C.white,alignItems:'center',justifyContent:'center'},homeText:{fontSize:15,color:C.white},metrics:{flexDirection:'row',gap:10,marginTop:12},metric:{flex:1,backgroundColor:'#F7F8FA',borderRadius:13,padding:11},metricValue:{fontSize:18,fontWeight:'900',color:C.ink},metricLabel:{fontSize:9,color:C.muted,marginTop:2},estimate:{fontSize:10,color:C.muted,marginTop:10},updated:{fontSize:10,color:C.muted,marginTop:4},error:{fontSize:10,color:C.red,backgroundColor:'#FFF0F0',padding:9,borderRadius:10,marginTop:8},state:{backgroundColor:C.white,borderRadius:18,borderWidth:1,borderColor:C.line,padding:24,alignItems:'center',justifyContent:'center',gap:8,marginBottom:14},muted:{fontSize:11,color:C.muted,textAlign:'center',lineHeight:17},errorTitle:{fontSize:15,fontWeight:'900',color:C.ink},retry:{backgroundColor:C.orange,borderRadius:11,paddingHorizontal:15,paddingVertical:9,marginTop:4},retryText:{fontSize:11,fontWeight:'900',color:C.white},delivered:{fontSize:26,color:C.green}});
