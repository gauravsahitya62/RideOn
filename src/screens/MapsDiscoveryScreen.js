import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { rideOnApi } from '../services/api';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',bg:'#F6F7F9',white:'#FFFFFF',line:'#E8EAF0',green:'#258565'};
const isExpoGo=Constants.appOwnership==='expo';

const pointFromLocation=(location)=>location?.coords ? {latitude:Number(location.coords.latitude),longitude:Number(location.coords.longitude)} : null;

export default function MapsDiscoveryScreen({city,onBack,onBookVehicle}){
  const [vendors,setVendors]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selectedVendor,setSelectedVendor]=useState(null);
  const [vehicles,setVehicles]=useState([]);
  const [vehicleLoading,setVehicleLoading]=useState(false);
  const [query,setQuery]=useState('');
  const [deliveryAddress,setDeliveryAddress]=useState('');
  const [deliveryPoint,setDeliveryPoint]=useState(null);
  const [route,setRoute]=useState(null);
  const [routeLoading,setRouteLoading]=useState(false);
  const [routeError,setRouteError]=useState('');
  const [userPoint,setUserPoint]=useState(null);
  const [permissionState,setPermissionState]=useState('unknown');

  const loadVendors=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const result=await rideOnApi.listMapVendors({city});
      setVendors(Array.isArray(result?.vendors)?result.vendors:Array.isArray(result?.data)?result.data:[]);
    }catch(e){
      setError('Vendor locations are temporarily unavailable. Please retry.');
    }finally{setLoading(false);}
  },[city]);

  useEffect(()=>{loadVendors();},[loadVendors]);

  const loadVendorVehicles=useCallback(async(vendor)=>{
    if(!vendor)return;
    setSelectedVendor(vendor);setVehicleLoading(true);
    try{
      const result=await rideOnApi.listVehicles({city});
      const all=Array.isArray(result?.vehicles)?result.vehicles:Array.isArray(result?.data)?result.data:[];
      setVehicles(all.filter(v=>String(v.vendorId||v.ownerId||'')===String(vendor.vendorId)));
    }catch{
      setVehicles([]);
    }finally{setVehicleLoading(false);}
    setRoute(null);setRouteError('');
  },[city]);

  const requestCurrentLocation=useCallback(async()=>{
    setRouteError('');
    try{
      const permission=await Location.requestForegroundPermissionsAsync();
      setPermissionState(permission.status);
      if(permission.status!=='granted'){setRouteError('Location access is optional. You can select a point on the map instead.');return;}
      const current=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
      const point=pointFromLocation(current);
      if(point){
        setUserPoint(point);
        setDeliveryPoint(point);
        setDeliveryAddress('Current location');
      }
    }catch{
      setRouteError('We could not read your current location. You can select a point on the map instead.');
    }
  },[]);

  const geocode=useCallback(async()=>{
    const requested=deliveryAddress.trim();
    if(!requested){setRouteError('Enter a delivery address first.');return;}
    if(/^current location$/i.test(requested)){await requestCurrentLocation();return;}
    setRouteLoading(true);setRouteError('');
    try{
      const result=await rideOnApi.geocodeAddress(deliveryAddress,city);
      const point=result?.location;
      if(!point){setRouteError('We could not find that address. Try a nearby landmark or tap the map.');return;}
      setDeliveryPoint(point);
    }catch(e){
      setRouteError(e?.message?.includes('not configured')?'Address search is not available yet. Tap the map to choose your delivery point.':'We could not find that address. Try a nearby landmark or tap the map.');
    }finally{setRouteLoading(false);}
  },[deliveryAddress,city]);

  const calculateRoute=useCallback(async()=>{
    if(!selectedVendor||!deliveryPoint)return;
    setRouteLoading(true);setRouteError('');
    try{
      const result=await rideOnApi.getRouteEta(selectedVendor.vendorId,deliveryPoint.latitude,deliveryPoint.longitude);
      setRoute(result?.route||null);
    }catch{
      setRoute(null);setRouteError('Delivery distance and ETA are temporarily unavailable. Please retry.');
    }finally{setRouteLoading(false);}
  },[selectedVendor,deliveryPoint]);

  useEffect(()=>{calculateRoute();},[calculateRoute]);

  const region=useMemo(()=>{
    const points=[...vendors.map(v=>({latitude:Number(v.latitude),longitude:Number(v.longitude)})),userPoint,deliveryPoint].filter(p=>p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    if(!points.length)return null;
    const lats=points.map(p=>p.latitude),lons=points.map(p=>p.longitude);
    return {latitude:(Math.min(...lats)+Math.max(...lats))/2,longitude:(Math.min(...lons)+Math.max(...lons))/2,latitudeDelta:Math.max(.04,Math.min(1,(Math.max(...lats)-Math.min(...lats))*.9+.04)),longitudeDelta:Math.max(.04,Math.min(1,(Math.max(...lons)-Math.min(...lons))*.9+.04))};
  },[vendors,userPoint,deliveryPoint,city]);

  return <View style={styles.root}>
    <View style={styles.top}><TouchableOpacity onPress={onBack} style={styles.back}><Text style={styles.backGlyph}>‹</Text></TouchableOpacity><View><Text style={styles.kicker}>RIDEON MAP</Text><Text style={styles.title}>Vendors in {city}</Text></View><View style={{width:42}}/></View>
    <View style={styles.mapWrap}>
      {loading?<View style={styles.mapState}><ActivityIndicator color={C.orange}/><Text style={styles.muted}>Loading vendor locations…</Text></View>:
      !region?<View style={styles.mapState}><Text style={styles.sectionTitle}>Map location unavailable</Text><Text style={styles.muted}>No location data is available for {city || 'this city'} yet.</Text></View>:
      <MapView provider={!isExpoGo && (Platform.OS==='android'||Platform.OS==='ios') ? PROVIDER_GOOGLE : undefined} style={StyleSheet.absoluteFill} initialRegion={region} region={region} showsUserLocation={Boolean(userPoint)} showsMyLocationButton={false} onPress={event=>{const c=event.nativeEvent.coordinate;setDeliveryPoint(c);if(!deliveryAddress)setDeliveryAddress('Map selected location');}}>
        {vendors.map(v=><Marker key={v.vendorId} coordinate={{latitude:Number(v.latitude),longitude:Number(v.longitude)}} onPress={()=>loadVendorVehicles(v)}>
          <View style={[styles.marker,selectedVendor?.vendorId===v.vendorId&&styles.markerSelected]}><Text style={styles.markerText}>⌖</Text></View>
        </Marker>)}
        {deliveryPoint&&<Marker coordinate={deliveryPoint}><View style={styles.deliveryMarker}><Text>●</Text></View></Marker>}
      </MapView>}
      <View style={styles.mapHint}><Text style={styles.mapHintText}>Tap a vendor marker to see vehicles. Tap the map to set a delivery point.</Text></View>
      <TouchableOpacity style={styles.locateButton} onPress={requestCurrentLocation}><Text style={styles.locateText}>⌖</Text></TouchableOpacity>
    </View>
    <View style={styles.sheet}>
      <Text style={styles.sectionTitle}>Delivery location</Text>
      <View style={styles.searchRow}><TextInput value={deliveryAddress} onChangeText={setDeliveryAddress} placeholder="Enter address or landmark" placeholderTextColor="#A0A7B1" style={styles.input}/><TouchableOpacity onPress={geocode} disabled={routeLoading} style={styles.searchButton}><Text style={styles.searchText}>Find</Text></TouchableOpacity></View>
      <TouchableOpacity onPress={requestCurrentLocation} style={styles.locationLink}><Text style={styles.link}>Use my current location</Text><Text style={styles.muted}>{permissionState==='denied'?'Location denied — map selection still works.':'Optional'}</Text></TouchableOpacity>
      {error?<Text style={styles.error}>{error}</Text>:null}
      {routeError?<Text style={styles.error}>{routeError}</Text>:null}
      {selectedVendor?<View style={styles.vendorCard}>
        <View style={{flex:1}}><Text style={styles.vendorName}>{selectedVendor.businessName}</Text><Text style={styles.muted}>{selectedVendor.serviceCity||city}{selectedVendor.address?' · '+selectedVendor.address:''}</Text><Text style={styles.vendorMeta}>{selectedVendor.availableVehicleCount} vehicle{selectedVendor.availableVehicleCount===1?'':'s'} available</Text></View>
        {routeLoading?<ActivityIndicator color={C.orange}/>:route?<View style={styles.routeBox}><Text style={styles.routeValue}>{(route.distanceMeters/1000).toFixed(1)} km</Text><Text style={styles.routeLabel}>distance</Text><Text style={styles.routeValue}>{route.estimatedDeliveryMinutes} min</Text><Text style={styles.routeLabel}>estimated delivery</Text></View>:null}
      </View>:<View style={styles.empty}><Text style={styles.sectionTitle}>Select a vendor</Text><Text style={styles.muted}>Choose a service-location marker to browse its vehicles.</Text></View>}
      {selectedVendor&&<View style={styles.vehicles}>
        <Text style={styles.sectionTitle}>Vehicles from {selectedVendor.businessName}</Text>
        {vehicleLoading?<Text style={styles.muted}>Loading vehicles…</Text>:
          vehicles.length?vehicles.map(v=><View key={v.id} style={styles.vehicleRow}><View style={{flex:1}}><Text style={styles.vehicleName}>{v.name}</Text><Text style={styles.muted}>{v.type} · ₹{Number(v.pricePerDay||v.price||0).toLocaleString('en-IN')} / day</Text></View><TouchableOpacity onPress={()=>onBookVehicle?.(v)} style={styles.bookButton}><Text style={styles.bookText}>View / book</Text></TouchableOpacity></View>):
          <Text style={styles.muted}>No active vehicles are currently listed for this vendor.</Text>}
      </View>}
    </View>
  </View>;
}

const styles=StyleSheet.create({
root:{flex:1,backgroundColor:C.bg},top:{height:64,paddingHorizontal:16,backgroundColor:C.white,borderBottomWidth:1,borderBottomColor:C.line,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},back:{width:42,height:42,borderRadius:21,backgroundColor:C.bg,alignItems:'center',justifyContent:'center'},backGlyph:{fontSize:32,color:C.ink,lineHeight:34},kicker:{fontSize:9,fontWeight:'900',letterSpacing:1.2,color:C.orange},title:{fontSize:17,fontWeight:'900',color:C.ink,marginTop:2},mapWrap:{height:350,backgroundColor:'#E7ECF2'},mapState:{flex:1,alignItems:'center',justifyContent:'center',gap:8},mapHint:{position:'absolute',left:16,right:70,bottom:14,backgroundColor:'#FFFFFFEA',borderRadius:12,padding:10},mapHintText:{fontSize:10,color:C.muted,lineHeight:15},locateButton:{position:'absolute',right:16,bottom:14,width:44,height:44,borderRadius:22,backgroundColor:C.white,alignItems:'center',justifyContent:'center'},locateText:{fontSize:20,color:C.orange},marker:{width:38,height:38,borderRadius:19,backgroundColor:C.orange,alignItems:'center',justifyContent:'center',borderWidth:3,borderColor:C.white},markerSelected:{transform:[{scale:1.1}]},markerText:{color:C.white,fontSize:18,fontWeight:'900'},deliveryMarker:{width:30,height:30,borderRadius:15,backgroundColor:'#1D74F5',borderWidth:3,borderColor:C.white,alignItems:'center',justifyContent:'center'},sheet:{flex:1,padding:16},sectionTitle:{fontSize:14,fontWeight:'900',color:C.ink,marginBottom:8},searchRow:{flexDirection:'row',gap:8},input:{flex:1,backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:13,paddingHorizontal:13,paddingVertical:11,fontSize:13,color:C.ink},searchButton:{backgroundColor:C.orange,borderRadius:13,paddingHorizontal:16,alignItems:'center',justifyContent:'center'},searchText:{color:C.white,fontWeight:'900'},locationLink:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:9},link:{fontSize:11,fontWeight:'900',color:C.orange},muted:{fontSize:11,color:C.muted,lineHeight:17},error:{fontSize:11,color:'#B23B3B',backgroundColor:'#FFF0F0',borderRadius:10,padding:10,marginBottom:8},vendorCard:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:18,padding:14,flexDirection:'row',gap:12,marginTop:6},vendorName:{fontSize:15,fontWeight:'900',color:C.ink},vendorMeta:{fontSize:10,fontWeight:'800',color:C.green,marginTop:5},routeBox:{minWidth:82,alignItems:'flex-end',justifyContent:'center'},routeValue:{fontSize:16,fontWeight:'900',color:C.ink},routeLabel:{fontSize:8,color:C.muted,marginBottom:4},vehicles:{marginTop:14},vehicleRow:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:14,padding:12,flexDirection:'row',alignItems:'center',gap:10,marginBottom:8},vehicleName:{fontSize:13,fontWeight:'900',color:C.ink},bookButton:{backgroundColor:'#FFF0E9',borderRadius:11,paddingHorizontal:11,paddingVertical:9},bookText:{fontSize:10,fontWeight:'900',color:C.orange},empty:{backgroundColor:C.white,borderRadius:15,borderWidth:1,borderColor:C.line,padding:14,marginTop:6}
});
