import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { rideOnApi } from '../services/api';

const C={ink:'#111827',muted:'#6B7280',orange:'#E56A3D',bg:'#F7F5F1',white:'#FFFFFF',line:'#E7E2DA',blue:'#2D7FF9'};
const CITY_REGIONS={udaipur:{latitude:24.5854,longitude:73.7125,latitudeDelta:0.12,longitudeDelta:0.12},jaipur:{latitude:26.9124,longitude:75.7873,latitudeDelta:0.12,longitudeDelta:0.12}};

export default function DeliveryLocationPicker({value,onChange,city}){
  const [draftAddress,setDraftAddress]=useState(value?.address||'');
  const [searchBusy,setSearchBusy]=useState(false);
  const [error,setError]=useState('');
  const [permission,setPermission]=useState('unknown');
  const [currentPoint,setCurrentPoint]=useState(value?.latitude!=null?{latitude:Number(value.latitude),longitude:Number(value.longitude)}:null);

  useEffect(()=>{
    setDraftAddress(value?.address||'');
    if(value?.latitude!=null&&value?.longitude!=null)setCurrentPoint({latitude:Number(value.latitude),longitude:Number(value.longitude)});
  },[value?.address,value?.latitude,value?.longitude]);

  const setPoint=(point,address=draftAddress||'Map selected delivery location')=>{
    const next={address:address.trim()||'Map selected delivery location',latitude:Number(point.latitude),longitude:Number(point.longitude)};
    setCurrentPoint(point);onChange?.(next);setError('');
  };

  const useCurrent=async()=>{
    setError('');
    try{
      const result=await Location.requestForegroundPermissionsAsync();
      setPermission(result.status);
      if(result.status!=='granted'){setError('Location access is optional. Tap the map or search an address instead.');return;}
      const current=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
      const point={latitude:Number(current.coords.latitude),longitude:Number(current.coords.longitude)};
      setPoint(point,'Current device location');
    }catch{setError('We could not read your current location. Tap the map or search an address instead.');}
  };

  const search=async()=>{
    const address=draftAddress.trim();
    if(address.length<4){setError('Enter a longer address or nearby landmark.');return;}
    setSearchBusy(true);setError('');
    try{
      const result=await rideOnApi.geocodeAddress(address,city);
      if(!result?.location){setError('We could not find that address. Try a nearby landmark or tap the map.');return;}
      setDraftAddress(result.formattedAddress||address);
      setPoint(result.location,result.formattedAddress||address);
    }catch(error){
      if(error?.code==='GEOCODE_PROVIDER_NOT_CONFIGURED')setError('Address search is not configured yet. Tap the map to choose your delivery point.');
      else setError(error?.message||'We could not find that address. Try a nearby landmark or tap the map.');
    }finally{setSearchBusy(false);}
  };

  const cityKey=String(city||'').trim().toLowerCase();
  const region=currentPoint?{...currentPoint,latitudeDelta:.05,longitudeDelta:.05}:(CITY_REGIONS[cityKey]||CITY_REGIONS.udaipur);

  return <View style={styles.wrap}>
    <View style={styles.row}><TextInput value={draftAddress} onChangeText={text=>{setDraftAddress(text);setError('');}} placeholder="Delivery address or landmark" placeholderTextColor="#A0A7B1" style={styles.input} multiline/><TouchableOpacity onPress={search} disabled={searchBusy} style={styles.find}>{searchBusy?<ActivityIndicator color={C.white}/>:<Text style={styles.findText}>Find</Text>}</TouchableOpacity></View>
    <View style={styles.mapWrap}>
      <MapView provider={Platform.OS==='android'?PROVIDER_GOOGLE:undefined} style={StyleSheet.absoluteFill} initialRegion={region} region={region} showsUserLocation={false} onPress={event=>setPoint(event.nativeEvent.coordinate)} onMapReady={()=>setError('')}>
        {currentPoint&&<Marker coordinate={currentPoint}><View style={styles.pin}><Text style={styles.pinText}>●</Text></View></Marker>}
      </MapView>
      <View style={styles.hint}><Text style={styles.hintText}>Tap the map to place the delivery point.</Text></View>
    </View>
    <View style={styles.actions}><TouchableOpacity onPress={useCurrent} style={styles.secondary}><Text style={styles.secondaryText}>⌖ Use my location</Text></TouchableOpacity><Text style={styles.status}>{currentPoint?'Location selected':'No map point selected'}{permission==='denied'?' · permission denied':''}</Text></View>
    {error?<Text style={styles.error}>{error}</Text>:null}
    <Text style={styles.helper}>Address is used for delivery instructions. The selected coordinates are used for routing and ETA.</Text>
  </View>;
}

const styles=StyleSheet.create({
wrap:{marginTop:4},row:{flexDirection:'row',gap:8,alignItems:'stretch'},input:{flex:1,minHeight:50,maxHeight:90,backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:13,paddingHorizontal:13,paddingVertical:10,fontSize:13,color:C.ink},find:{width:64,backgroundColor:C.orange,borderRadius:13,alignItems:'center',justifyContent:'center'},findText:{color:C.white,fontWeight:'900'},mapWrap:{height:210,marginTop:10,borderRadius:20,overflow:'hidden',backgroundColor:'#E7ECF2',borderWidth:1,borderColor:C.line},hint:{position:'absolute',left:12,right:12,bottom:10,backgroundColor:'#FFFFFFE8',padding:8,borderRadius:10},hintText:{fontSize:10,color:C.muted,fontWeight:'700'},pin:{width:30,height:30,borderRadius:15,backgroundColor:C.blue,borderWidth:3,borderColor:C.white,alignItems:'center',justifyContent:'center'},pinText:{fontSize:11,color:C.white},actions:{flexDirection:'row',alignItems:'center',gap:10,marginTop:9},secondary:{borderWidth:1,borderColor:C.line,backgroundColor:C.white,borderRadius:11,paddingHorizontal:11,paddingVertical:9},secondaryText:{fontSize:10,fontWeight:'900',color:C.ink},status:{flex:1,fontSize:10,color:C.muted,lineHeight:15},error:{marginTop:8,color:'#B23B3B',backgroundColor:'#FFF0F0',borderRadius:10,padding:9,fontSize:10,lineHeight:15},helper:{marginTop:8,color:C.muted,fontSize:9,lineHeight:14}
});
