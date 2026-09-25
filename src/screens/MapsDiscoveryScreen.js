import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { rideOnApi } from '../services/api';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',bg:'#F6F7F9',white:'#FFFFFF',line:'#E8EAF0',green:'#258565'};
const isExpoGo=Constants.appOwnership==='expo';
const CITY_CENTERS={udaipur:{latitude:24.5854,longitude:73.7125}};
const DEFAULT_ZOOM={latitudeDelta:.16,longitudeDelta:.16};
const defaultRegionForCity=value=>({...CITY_CENTERS[String(value||'').trim().toLowerCase()]||CITY_CENTERS.udaipur,...DEFAULT_ZOOM});

export default function MapsDiscoveryScreen({city,onBack,onBookVehicle}){
  const [vehicles,setVehicles]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selectedVehicle,setSelectedVehicle]=useState(null);
  const [query,setQuery]=useState('');
  const [deliveryAddress,setDeliveryAddress]=useState('');
  const [deliveryPoint,setDeliveryPoint]=useState(null);
  const [route,setRoute]=useState(null);
  const [routeLoading,setRouteLoading]=useState(false);
  const [routeError,setRouteError]=useState('');
  const [userPoint,setUserPoint]=useState(null);
  const [permissionState,setPermissionState]=useState('unknown');
  const [mapRegion,setMapRegion]=useState(defaultRegionForCity(city));

  const loadFleet=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const result=await rideOnApi.listFleet({city});
      const list=Array.isArray(result?.vehicles)?result.vehicles:Array.isArray(result?.data)?result.data:Array.isArray(result?.fleet)?result.fleet:[];
      setVehicles(list.filter(v=>v?.id&&v?.pickupLatitude!=null&&v?.pickupLongitude!=null));
    }catch(e){setVehicles([]);setError(e?.message||'RideOn pickup locations are temporarily unavailable. Please retry.');}
    finally{setLoading(false);}
  },[city]);

  useEffect(()=>{setMapRegion(defaultRegionForCity(city));loadFleet();},[city,loadFleet]);

  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return vehicles.filter(v=>!q||[v.name,v.make,v.model,v.city].filter(Boolean).join(' ').toLowerCase().includes(q));
  },[vehicles,query]);

  const requestCurrentLocation=useCallback(async()=>{
    setRouteError('');
    try{
      const permission=await Location.requestForegroundPermissionsAsync();
      setPermissionState(permission.status);
      if(permission.status!=='granted'){setRouteError('Location access is optional. You can choose a delivery point on the map.');return;}
      const current=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
      const point={latitude:Number(current.coords.latitude),longitude:Number(current.coords.longitude)};
      setUserPoint(point);setDeliveryPoint(point);setDeliveryAddress('Current location');
    }catch{setRouteError('We could not read your current location. You can choose a delivery point on the map.');}
  },[]);

  const geocode=useCallback(async()=>{
    const requested=deliveryAddress.trim();
    if(!requested){setRouteError('Enter a delivery address first.');return;}
    if(/^current location$/i.test(requested)){await requestCurrentLocation();return;}
    setRouteLoading(true);setRouteError('');
    try{
      const result=await rideOnApi.geocodeAddress(requested,city);
      if(!result?.location){setRouteError('We could not find that address. Try a nearby landmark or tap the map.');return;}
      setDeliveryPoint({latitude:Number(result.location.latitude),longitude:Number(result.location.longitude)});
    }catch(e){setRouteError(e?.message?.includes('not configured')?'Address search is not available yet. Tap the map to choose your delivery point.':'We could not find that address. Try a nearby landmark or tap the map.');}
    finally{setRouteLoading(false);}
  },[deliveryAddress,city,requestCurrentLocation]);

  const calculateRoute=useCallback(async()=>{
    if(!selectedVehicle||!deliveryPoint)return;
    setRouteLoading(true);setRouteError('');
    try{
      const result=await rideOnApi.getRouteEta(selectedVehicle.id,deliveryPoint.latitude,deliveryPoint.longitude);
      setRoute(result?.route||null);
    }catch(e){setRoute(null);setRouteError(e?.message||'Delivery distance and ETA are temporarily unavailable. Please retry.');}
    finally{setRouteLoading(false);}
  },[selectedVehicle,deliveryPoint]);

  useEffect(()=>{calculateRoute();},[calculateRoute]);

  const selectVehicle=vehicle=>{setSelectedVehicle(vehicle);setRoute(null);setRouteError('');};
  const retry=()=>loadFleet();

  return <View style={styles.root}>
    <View style={styles.top}><TouchableOpacity onPress={onBack} style={styles.back}><Text style={styles.backGlyph}>‹</Text></TouchableOpacity><View><Text style={styles.kicker}>RIDEON MAP</Text><Text style={styles.title}>Pickup locations in {city}</Text></View><View style={{width:42}}/></View>
    <View style={styles.mapWrap}>
      {loading?<View style={styles.mapState}><ActivityIndicator color={C.orange}/><Text style={styles.muted}>Loading RideOn pickup locations…</Text></View>:
      <MapView provider={!isExpoGo&&(Platform.OS==='android'||Platform.OS==='ios')?PROVIDER_GOOGLE:undefined} style={StyleSheet.absoluteFill} initialRegion={mapRegion} region={mapRegion} showsUserLocation={Boolean(userPoint)} showsMyLocationButton={false} onPress={event=>{setDeliveryPoint(event.nativeEvent.coordinate);setDeliveryAddress('Map selected location');}}>
        {filtered.map(v=><Marker key={String(v.id)} coordinate={{latitude:Number(v.pickupLatitude),longitude:Number(v.pickupLongitude)}} onPress={()=>selectVehicle(v)}>
          <View style={[styles.marker,selectedVehicle?.id===v.id&&styles.markerSelected]}><Text style={styles.markerText}>{String(v.fleetVehicleClass||v.type||'bike').toLowerCase()==='scooter'?'🛵':'🏍️'}</Text></View>
        </Marker>)}
        {deliveryPoint&&<Marker coordinate={deliveryPoint}><View style={styles.deliveryMarker}><Text>●</Text></View></Marker>}
      </MapView>}
      <View style={styles.mapHint}><Text style={styles.mapHintText}>Tap a RideOn pickup marker to select a vehicle. Tap the map to set a delivery point.</Text></View>
      <TouchableOpacity style={styles.locateButton} onPress={requestCurrentLocation}><Text style={styles.locateText}>⌖</Text></TouchableOpacity>
    </View>
    <View style={styles.sheet}>
      <View style={styles.searchRow}><TextInput value={query} onChangeText={setQuery} placeholder="Search RideOn vehicles" placeholderTextColor="#A0A7B1" style={styles.input}/><TouchableOpacity onPress={retry} style={styles.searchButton}><Text style={styles.searchText}>Refresh</Text></TouchableOpacity></View>
      <TextInput value={deliveryAddress} onChangeText={setDeliveryAddress} placeholder="Delivery address or landmark" placeholderTextColor="#A0A7B1" style={[styles.input,{marginTop:8}]}/>
      <View style={styles.actionRow}><TouchableOpacity onPress={geocode} disabled={routeLoading} style={styles.searchButton}><Text style={styles.searchText}>Find address</Text></TouchableOpacity><TouchableOpacity onPress={requestCurrentLocation} style={styles.locationLink}><Text style={styles.link}>Use my location</Text></TouchableOpacity></View>
      {permissionState==='denied'&&<Text style={styles.muted}>Location permission denied; map selection still works.</Text>}
      {error?<Text style={styles.error}>{error}</Text>:null}
      {routeError?<Text style={styles.error}>{routeError}</Text>:null}
      {!selectedVehicle?<View style={styles.empty}><Text style={styles.sectionTitle}>Select a RideOn vehicle</Text><Text style={styles.muted}>Only RideOn-owned bikes and scooters with configured pickup coordinates are shown.</Text></View>:
      <View style={styles.vehicleCard}>
        <View style={{flex:1}}><Text style={styles.vehicleName}>{selectedVehicle.name}</Text><Text style={styles.muted}>{selectedVehicle.city||city} · {selectedVehicle.fleetVehicleClass||selectedVehicle.type} · ₹{Number(selectedVehicle.pricePerDay||selectedVehicle.price||0).toLocaleString('en-IN')} / day</Text></View>
        {routeLoading?<ActivityIndicator color={C.orange}/>:route?<View style={styles.routeBox}><Text style={styles.routeValue}>{(Number(route.distanceMeters)/1000).toFixed(1)} km</Text><Text style={styles.routeLabel}>distance</Text><Text style={styles.routeValue}>{route.estimatedDeliveryMinutes} min</Text><Text style={styles.routeLabel}>ETA</Text></View>:null}
        <TouchableOpacity onPress={()=>onBookVehicle?.(selectedVehicle)} style={styles.bookButton}><Text style={styles.bookText}>View / book</Text></TouchableOpacity>
      </View>}
    </View>
  </View>;
}

const styles=StyleSheet.create({
root:{flex:1,backgroundColor:C.bg},top:{height:64,paddingHorizontal:16,backgroundColor:C.white,borderBottomWidth:1,borderBottomColor:C.line,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},back:{width:42,height:42,borderRadius:21,backgroundColor:C.bg,alignItems:'center',justifyContent:'center'},backGlyph:{fontSize:32,color:C.ink,lineHeight:34},kicker:{fontSize:9,fontWeight:'900',letterSpacing:1.2,color:C.orange},title:{fontSize:17,fontWeight:'900',color:C.ink,marginTop:2},mapWrap:{height:350,backgroundColor:'#E7ECF2'},mapState:{flex:1,alignItems:'center',justifyContent:'center',gap:8},mapHint:{position:'absolute',left:16,right:70,bottom:14,backgroundColor:'#FFFFFFEA',borderRadius:12,padding:10},mapHintText:{fontSize:10,color:C.muted,lineHeight:15},locateButton:{position:'absolute',right:16,bottom:14,width:44,height:44,borderRadius:22,backgroundColor:C.white,alignItems:'center',justifyContent:'center'},locateText:{fontSize:20,color:C.orange},marker:{width:40,height:40,borderRadius:20,backgroundColor:C.orange,alignItems:'center',justifyContent:'center',borderWidth:3,borderColor:C.white},markerSelected:{transform:[{scale:1.1}]},markerText:{fontSize:18},deliveryMarker:{width:30,height:30,borderRadius:15,backgroundColor:'#1D74F5',borderWidth:3,borderColor:C.white,alignItems:'center',justifyContent:'center'},searchRow:{flexDirection:'row',gap:8},input:{flex:1,backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:13,paddingHorizontal:13,paddingVertical:11,fontSize:13,color:C.ink},searchButton:{backgroundColor:C.orange,borderRadius:13,paddingHorizontal:16,paddingVertical:11,alignItems:'center',justifyContent:'center'},actionRow:{flexDirection:'row',alignItems:'center',gap:10,marginTop:8},locationLink:{padding:10},link:{fontSize:11,fontWeight:'900',color:C.orange},sheet:{flex:1,padding:16},sectionTitle:{fontSize:14,fontWeight:'900',color:C.ink,marginBottom:8},muted:{fontSize:11,color:C.muted,lineHeight:17},error:{fontSize:11,color:'#B23B3B',backgroundColor:'#FFF0F0',borderRadius:10,padding:10,marginTop:8},vehicleCard:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:18,padding:14,flexDirection:'row',alignItems:'center',gap:10,marginTop:12},vehicleName:{fontSize:15,fontWeight:'900',color:C.ink},routeBox:{minWidth:66,alignItems:'flex-end',justifyContent:'center'},routeValue:{fontSize:15,fontWeight:'900',color:C.ink},routeLabel:{fontSize:8,color:C.muted,marginBottom:4},bookButton:{backgroundColor:'#FFF0E9',borderRadius:11,paddingHorizontal:11,paddingVertical:9},bookText:{fontSize:10,fontWeight:'900',color:C.orange},empty:{backgroundColor:C.white,borderRadius:15,borderWidth:1,borderColor:C.line,padding:14,marginTop:12}
});