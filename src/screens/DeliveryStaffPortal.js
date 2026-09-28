import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { rideOnApi, restoreAccessToken } from '../services/api';

const C={bg:'#F7F5F1',white:'#FFFFFF',ink:'#121A28',muted:'#737D8C',line:'#E7E1D9',orange:'#EF6238',green:'#198C67',red:'#C94B4B',navy:'#101827'};
const BACKGROUND_TASK='rideon-delivery-background-location';
const ACTIVE_BOOKING_KEY='rideon_active_delivery_booking';
const ACTIVE_TOKEN_KEY='rideon_active_delivery_token';
const API_URL=(process.env.EXPO_PUBLIC_API_URL||'https://rideon-api-262g.onrender.com').replace(/\/+$/,'');

if(!TaskManager.isTaskDefined(BACKGROUND_TASK)){
  TaskManager.defineTask(BACKGROUND_TASK, async ({data,error})=>{
    if(error||!data?.locations?.length)return;
    try{
      const token=await import('expo-secure-store').then(m=>m.getItemAsync(ACTIVE_TOKEN_KEY));
      const bookingId=await import('expo-secure-store').then(m=>m.getItemAsync(ACTIVE_BOOKING_KEY));
      if(!token||!bookingId)return;
      const location=data.locations[data.locations.length-1];
      const {latitude,longitude,accuracy}=location.coords||{};
      if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return;
      await fetch(`${API_URL}/api/v1/delivery/jobs/${encodeURIComponent(bookingId)}/location`,{
        method:'POST',
        headers:{Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({latitude,longitude,accuracyMeters:Number.isFinite(accuracy)?accuracy:undefined,recordedAt:new Date(location.timestamp||Date.now()).toISOString()}),
      });
    }catch{}
  });
}

export default function DeliveryStaffPortal({ authenticatedUser, onLogout }) {
  const [tab,setTab]=useState('available');
  const [available,setAvailable]=useState([]);
  const [mine,setMine]=useState([]);
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState(null);
  const [error,setError]=useState('');
  const [activeJob,setActiveJob]=useState(null);
  const [tracking,setTracking]=useState(false);
  const [position,setPosition]=useState(null);
  const watchRef=useRef(null);

  const loadJobs=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const [a,m]=await Promise.all([rideOnApi.listDeliveryJobs('available'),rideOnApi.listDeliveryJobs('mine')]);
      setAvailable(a?.jobs||a?.data||[]);
      setMine(m?.jobs||m?.data||[]);
    }catch(e){setError(e?.message||'Could not load delivery jobs.');}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{loadJobs();const id=setInterval(loadJobs,30000);return()=>clearInterval(id);},[loadJobs]);

  const stopTracking=useCallback(async()=>{
    if(watchRef.current){watchRef.current.remove();watchRef.current=null;}
    try{
      if(await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK)) await Location.stopLocationUpdatesAsync(BACKGROUND_TASK);
    }catch{}
    const SecureStore=await import('expo-secure-store');
    await SecureStore.deleteItemAsync(ACTIVE_BOOKING_KEY).catch(()=>{});
    await SecureStore.deleteItemAsync(ACTIVE_TOKEN_KEY).catch(()=>{});
    setTracking(false);
    setActiveJob(null);
  },[]);

  const startTracking=useCallback(async(job,mode='delivery')=>{
    setBusyId(job.bookingId);setError('');
    try{
      const fg=await Location.requestForegroundPermissionsAsync();
      if(fg.status!=='granted')throw new Error('Location permission is required to deliver the vehicle.');
      let bg=await Location.getBackgroundPermissionsAsync();
      if(bg.status!=='granted')bg=await Location.requestBackgroundPermissionsAsync();
      const SecureStore=await import('expo-secure-store');
      const token=await restoreAccessToken();
      await SecureStore.setItemAsync(ACTIVE_BOOKING_KEY,String(job.bookingId));
      if(token)await SecureStore.setItemAsync(ACTIVE_TOKEN_KEY,String(token));
      const startResult=mode==='pickup'?await rideOnApi.startPickupJob(job.bookingId):await rideOnApi.startDeliveryJob(job.bookingId);
      setActiveJob({...job,trackingMode:mode});
      setTracking(true);
      const current=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
      setPosition({latitude:current.coords.latitude,longitude:current.coords.longitude});
      await rideOnApi.updateDeliveryJobLocation(job.bookingId,{latitude:current.coords.latitude,longitude:current.coords.longitude,accuracyMeters:current.coords.accuracy||undefined,recordedAt:new Date(current.timestamp||Date.now()).toISOString()}).catch(()=>{});
      watchRef.current=await Location.watchPositionAsync({accuracy:Location.Accuracy.High,distanceInterval:20,timeInterval:5000},async loc=>{
        const {latitude,longitude,accuracy}=loc.coords||{};
        if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return;
        setPosition({latitude,longitude});
        try{await rideOnApi.updateDeliveryJobLocation(job.bookingId,{latitude,longitude,accuracyMeters:Number.isFinite(accuracy)?accuracy:undefined,recordedAt:new Date(loc.timestamp||Date.now()).toISOString()});}catch{}
      });
      if(bg.status==='granted'){
        try{if(!await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK))await Location.startLocationUpdatesAsync(BACKGROUND_TASK,{accuracy:Location.Accuracy.High,distanceInterval:25,timeInterval:10000,pausesUpdatesAutomatically:false,showsBackgroundLocationIndicator:true,foregroundService:{notificationTitle:'RideOn delivery in progress',notificationBody:'Live GPS tracking is active while you deliver this vehicle.',notificationColor:C.orange}});}catch{}
      }
      return startResult;
    }catch(e){setError(e?.message||'Could not start live tracking.');await stopTracking();}
    finally{setBusyId(null);}
  },[stopTracking]);

  const accept=async job=>{
    setBusyId(job.bookingId);setError('');
    try{await rideOnApi.acceptDeliveryJob(job.bookingId);await loadJobs();setTab('mine');}
    catch(e){setError(e?.message||'This delivery could not be accepted.');}
    finally{setBusyId(null);}
  };

  const completeDelivery=async()=>{
    if(!activeJob)return;
    setBusyId(activeJob.bookingId);setError('');
    try{
      await rideOnApi.completeDeliveryJob(activeJob.bookingId,position||{});
      await stopTracking();await loadJobs();
    }catch(e){setError(e?.message||'Delivery could not be completed.');}
    finally{setBusyId(null);}
  };

  const requestPickup=async job=>{
    setBusyId(job.bookingId);setError('');
    try{await rideOnApi.requestDeliveryPickup(job.bookingId);await loadJobs();}
    catch(e){setError(e?.message||'Pickup could not be requested yet.');}
    finally{setBusyId(null);}
  };

  const completePickup=async()=>{
    if(!activeJob)return;
    setBusyId(activeJob.bookingId);setError('');
    try{
      await rideOnApi.completePickupJob(activeJob.bookingId,{...(position||{}),returnLocation:activeJob.returnLocation||activeJob.address||null});
      await stopTracking();await loadJobs();
    }catch(e){setError(e?.message||'Pickup could not be completed.');}
    finally{setBusyId(null);}
  };

  const openNavigation=job=>{
    const lat=job.deliveryLatitude,lon=job.deliveryLongitude;
    const url=Number.isFinite(lat)&&Number.isFinite(lon)?`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`:null;
    if(url)Linking.openURL(url);
  };

  const activeMapJob=activeJob||mine.find(j=>j.assignmentStatus==='started');
  const region=useMemo(()=>{
    const lat=position?.latitude??activeMapJob?.deliveryLatitude;
    const lon=position?.longitude??activeMapJob?.deliveryLongitude;
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
    return {latitude:lat,longitude:lon,latitudeDelta:.025,longitudeDelta:.025};
  },[position,activeMapJob]);

  return <SafeAreaView style={s.safe}><StatusBar barStyle="dark-content"/><View style={s.header}>
    <View><Text style={s.brand}>ride<Text style={{color:C.orange}}>.on</Text></Text><Text style={s.sub}>DELIVERY OPERATIONS</Text></View>
    <TouchableOpacity style={s.profile} onPress={()=>Alert.alert('Delivery account',authenticatedUser?.email||'RideOn delivery staff',[{text:'Sign out',style:'destructive',onPress:onLogout},{text:'Close',style:'cancel'}])}><Text style={s.profileText}>DS</Text></TouchableOpacity>
  </View>
  <View style={s.welcome}><View><Text style={s.eyebrow}>RIDER DASHBOARD</Text><Text style={s.title}>Ready for your next delivery?</Text></View><TouchableOpacity onPress={loadJobs}><Text style={s.refresh}>↻</Text></TouchableOpacity></View>
  <View style={s.tabs}><TouchableOpacity style={[s.tab,tab==='available'&&s.tabActive]} onPress={()=>setTab('available')}><Text style={[s.tabText,tab==='available'&&s.tabTextActive]}>Available</Text></TouchableOpacity><TouchableOpacity style={[s.tab,tab==='mine'&&s.tabActive]} onPress={()=>setTab('mine')}><Text style={[s.tabText,tab==='mine'&&s.tabTextActive]}>My jobs</Text></TouchableOpacity></View>
  {error?<View style={s.error}><Text style={s.errorText}>{error}</Text></View>:null}
  {tracking&&activeMapJob?<View style={s.liveCard}><View style={s.liveHeader}><View><Text style={s.liveKicker}>{activeJob?.trackingMode==='pickup'?'PICKUP':'DELIVERY'} · LIVE GPS</Text><Text style={s.liveTitle}>{activeMapJob.vehicle?.name}</Text></View><View style={s.liveDot}/></View>{region?<MapView style={s.map} initialRegion={region} region={region} showsUserLocation showsMyLocationButton><Marker coordinate={{latitude:position?.latitude??activeMapJob.deliveryLatitude,longitude:position?.longitude??activeMapJob.deliveryLongitude}} title="You"/>{Number.isFinite(activeMapJob.deliveryLatitude)&&Number.isFinite(activeMapJob.deliveryLongitude)&&<Marker coordinate={{latitude:activeMapJob.deliveryLatitude,longitude:activeMapJob.deliveryLongitude}} title="Customer"/></MapView>:null}<View style={s.liveActions}><TouchableOpacity style={s.navButton} onPress={()=>openNavigation(activeMapJob)}><Text style={s.navText}>Navigate</Text></TouchableOpacity><TouchableOpacity style={s.completeButton} onPress={activeJob?.trackingMode==='pickup'?completePickup:completeDelivery} disabled={busyId===activeMapJob.bookingId}><Text style={s.completeText}>{busyId===activeMapJob.bookingId?'Updating…':activeJob?.trackingMode==='pickup'?'Vehicle picked up':'Vehicle delivered'}</Text></TouchableOpacity></View></View>:null}
  <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
    {loading&&!available.length&&!mine.length?<View style={s.center}><ActivityIndicator color={C.orange}/><Text style={s.muted}>Loading delivery jobs…</Text></View>:tab==='available'?<>{!available.length?<Empty title="No delivery requests" text="New paid doorstep bookings will appear here when they are ready for a rider."/>:available.map(job=><DeliveryCard key={job.bookingId} job={job} busy={busyId===job.bookingId} action={<TouchableOpacity style={s.primary} onPress={()=>accept(job)} disabled={busyId===job.bookingId}><Text style={s.primaryText}>{busyId===job.bookingId?'Accepting…':'Accept delivery'}</Text></TouchableOpacity>} navigate={openNavigation}/>)}</>:<>{!mine.length?<Empty title="No active jobs" text="Accept a delivery request to see it here."/>:mine.map(job=><MyJobCard key={job.assignmentId||job.bookingId+job.assignmentType} job={job} busy={busyId===job.bookingId} tracking={tracking&&activeJob?.bookingId===job.bookingId} onStart={()=>startTracking(job,'delivery')} onRequestPickup={()=>requestPickup(job)} onStartPickup={()=>startTracking(job,'pickup')} navigate={openNavigation}/>)}</>}
  </ScrollView></SafeAreaView>;
}

function DeliveryCard({job,action,navigate,busy}){
  return <View style={s.card}><VehicleImage uri={job.vehicle?.imageUrls?.[0]}/><View style={s.cardBody}><View style={s.row}><View style={{flex:1}}><Text style={s.vehicle}>{job.vehicle?.name}</Text><Text style={s.muted}>{job.vehicle?.type||'RideOn vehicle'} · {job.bookingId.slice(0,8)}</Text></View><Text style={s.badge}>READY</Text></View><Text style={s.label}>CUSTOMER</Text><Text style={s.customer}>{job.customerName}</Text><Text style={s.address}>{job.address||'Doorstep address unavailable'}</Text><Text style={s.muted}>{job.scheduledAt?new Date(job.scheduledAt).toLocaleString('en-IN'):'Scheduled fulfillment'}</Text><View style={s.actions}><TouchableOpacity style={s.secondary} onPress={()=>navigate(job)}><Text style={s.secondaryText}>Navigate</Text></TouchableOpacity>{action}</View></View></View>;
}

function MyJobCard({job,busy,tracking,onStart,onRequestPickup,onStartPickup,navigate}){
  const type=job.assignmentType;
  const status=job.assignmentStatus;
  return <View style={s.card}><VehicleImage uri={job.vehicle?.imageUrls?.[0]}/><View style={s.cardBody}><View style={s.row}><View style={{flex:1}}><Text style={s.vehicle}>{job.vehicle?.name}</Text><Text style={s.muted}>{type==='pickup'?'PICKUP TASK':'DELIVERY TASK'} · {job.bookingId.slice(0,8)}</Text></View><Text style={[s.badge,type==='pickup'?s.badgePickup:s.badgeGreen]}>{status?.toUpperCase()||'ASSIGNED'}</Text></View><Text style={s.customer}>{job.customerName}</Text><Text style={s.address}>{job.address||'Address unavailable'}</Text><View style={s.timeline}><Text style={s.timelineText}>{type==='pickup'?'Collect vehicle after return request':'Deliver vehicle to customer'}</Text></View>{type==='delivery'&&status==='assigned'?<TouchableOpacity style={s.primary} onPress={onStart} disabled={busy}><Text style={s.primaryText}>{busy?'Starting…':'Start delivery + live GPS'}</Text></TouchableOpacity>:type==='delivery'&&status==='completed'?<TouchableOpacity style={s.primary} onPress={onRequestPickup} disabled={busy}><Text style={s.primaryText}>{busy?'Requesting…':'Request pickup for me'}</Text></TouchableOpacity>:type==='pickup'&&status==='assigned'?<TouchableOpacity style={s.primary} onPress={onStartPickup} disabled={busy}><Text style={s.primaryText}>{busy?'Starting…':'Start pickup + live GPS'}</Text></TouchableOpacity>:type==='pickup'&&status==='started'?<Text style={s.liveHint}>Live pickup tracking is active above.</Text>:null}{type==='delivery'&&status==='started'&&!tracking?<Text style={s.liveHint}>Delivery tracking is active. Return to the live panel above.</Text>:null}</View></View>;
}

function VehicleImage({uri}){
  if(!uri)return <View style={s.imageFallback}><Text style={{fontSize:32}}>🏍️</Text></View>;
  return <Image source={{uri}} style={s.vehicleImage} resizeMode="cover"/>;
}
function Empty({title,text}){return <View style={s.empty}><Text style={s.emptyTitle}>{title}</Text><Text style={s.muted}>{text}</Text></View>;}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},header:{paddingHorizontal:18,paddingTop:10,paddingBottom:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:C.line,backgroundColor:C.bg},brand:{fontSize:30,fontWeight:'900',letterSpacing:-1.5,color:C.ink},sub:{fontSize:8,fontWeight:'900',letterSpacing:1.5,color:C.muted,marginTop:-2},profile:{width:42,height:42,borderRadius:21,backgroundColor:C.ink,alignItems:'center',justifyContent:'center'},profileText:{color:'#fff',fontSize:11,fontWeight:'900'},welcome:{padding:18,paddingBottom:10,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},eyebrow:{fontSize:9,fontWeight:'900',letterSpacing:1.4,color:C.orange},title:{fontSize:24,fontWeight:'900',letterSpacing:-.7,color:C.ink,marginTop:4,maxWidth:320},refresh:{fontSize:28,color:C.ink},tabs:{flexDirection:'row',marginHorizontal:18,backgroundColor:C.white,borderRadius:15,padding:4,borderWidth:1,borderColor:C.line},tab:{flex:1,paddingVertical:10,borderRadius:11,alignItems:'center'},tabActive:{backgroundColor:C.ink},tabText:{fontSize:11,fontWeight:'900',color:C.muted},tabTextActive:{color:'#fff'},content:{padding:18,paddingTop:12,paddingBottom:30},card:{backgroundColor:C.white,borderRadius:21,borderWidth:1,borderColor:C.line,padding:12,marginBottom:13,shadowColor:'#000',shadowOpacity:.04,shadowRadius:10,shadowOffset:{width:0,height:4},elevation:2},cardBody:{paddingHorizontal:4},vehicleImage:{width:'100%',height:155,borderRadius:15,backgroundColor:'#F0ECE6'},imageFallback:{height:155,borderRadius:15,backgroundColor:'#F0ECE6',alignItems:'center',justifyContent:'center'},row:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:10},vehicle:{fontSize:19,fontWeight:'900',color:C.ink,marginTop:11},muted:{fontSize:11,color:C.muted,lineHeight:17,marginTop:3},label:{fontSize:8,fontWeight:'900',letterSpacing:1.2,color:C.muted,marginTop:13},customer:{fontSize:14,fontWeight:'800',color:C.ink,marginTop:4},address:{fontSize:13,color:C.ink,lineHeight:19,marginTop:4},badge:{fontSize:8,fontWeight:'900',letterSpacing:.9,color:C.orange,backgroundColor:'#FFF0E9',paddingHorizontal:9,paddingVertical:6,borderRadius:20},badgeGreen:{color:C.green,backgroundColor:'#EAF6F0'},badgePickup:{color:'#7256B8',backgroundColor:'#F1ECFF'},actions:{flexDirection:'row',gap:8,marginTop:13},primary:{flex:1,minHeight:48,borderRadius:15,backgroundColor:C.orange,alignItems:'center',justifyContent:'center',paddingHorizontal:12},primaryText:{color:'#fff',fontSize:12,fontWeight:'900'},secondary:{minHeight:48,borderRadius:15,borderWidth:1,borderColor:C.line,backgroundColor:C.white,alignItems:'center',justifyContent:'center',paddingHorizontal:15},secondaryText:{fontSize:11,fontWeight:'900',color:C.ink},timeline:{backgroundColor:'#F7F5F1',borderRadius:13,padding:11,marginTop:12},timelineText:{fontSize:11,fontWeight:'700',color:C.muted},liveCard:{marginHorizontal:18,marginBottom:4,backgroundColor:C.white,borderRadius:22,borderWidth:1,borderColor:'#D7EDE4',overflow:'hidden'},liveHeader:{padding:14,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},liveKicker:{fontSize:8,fontWeight:'900',letterSpacing:1.3,color:C.green},liveTitle:{fontSize:16,fontWeight:'900',color:C.ink,marginTop:3},liveDot:{width:11,height:11,borderRadius:6,backgroundColor:C.green},map:{height:280,width:'100%'},liveActions:{flexDirection:'row',gap:8,padding:12},navButton:{flex:1,height:48,borderRadius:14,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},navText:{fontSize:11,fontWeight:'900',color:C.ink},completeButton:{flex:1.5,height:48,borderRadius:14,backgroundColor:C.green,alignItems:'center',justifyContent:'center'},completeText:{fontSize:11,fontWeight:'900',color:'#fff'},liveHint:{fontSize:10,fontWeight:'800',color:C.green,marginTop:12},error:{marginHorizontal:18,marginTop:10,backgroundColor:'#FFF0F0',borderWidth:1,borderColor:'#F4CCCC',borderRadius:14,padding:12},errorText:{fontSize:11,fontWeight:'800',color:C.red,lineHeight:17},center:{alignItems:'center',justifyContent:'center',padding:50,gap:8},empty:{backgroundColor:C.white,borderRadius:20,borderWidth:1,borderColor:C.line,padding:24,alignItems:'center',gap:7},emptyTitle:{fontSize:17,fontWeight:'900',color:C.ink},
});