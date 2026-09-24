import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { rideOnApi } from '../services/api';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',bg:'#F6F7F9',white:'#FFFFFF',line:'#E8EAF0',blue:'#2D7FF9'};
const DEFAULT_REGION={latitude:26.9124,longitude:75.7873,latitudeDelta:.12,longitudeDelta:.12};

export default function ServiceLocationEditor({value,onChange}){
  const [address,setAddress]=useState(value?.address||'');
  const [city,setCity]=useState(value?.serviceCity||'');
  const [point,setPoint]=useState(value?.latitude!=null&&value?.longitude!=null?{latitude:Number(value.latitude),longitude:Number(value.longitude)}:null);
  const [error,setError]=useState('');

  useEffect(()=>{setAddress(value?.address||'');setCity(value?.serviceCity||'');if(value?.latitude!=null&&value?.longitude!=null)setPoint({latitude:Number(value.latitude),longitude:Number(value.longitude)});},[value]);

  const emit=(nextPoint=point)=>{
    onChange?.({address:address.trim(),serviceCity:city.trim(),latitude:nextPoint?.latitude??null,longitude:nextPoint?.longitude??null});
  };
  const useCurrent=async()=>{
    setError('');
    try{
      const permission=await Location.requestForegroundPermissionsAsync();
      if(permission.status!=='granted'){setError('Location access was denied. Tap the map to place your service location instead.');return;}
      const current=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
      const next={latitude:Number(current.coords.latitude),longitude:Number(current.coords.longitude)};
      setPoint(next);emit(next);
    }catch{setError('We could not read your current location. Tap the map to place your service location instead.');}
  };
  const selectPoint=coordinate=>{setPoint(coordinate);emit(coordinate);};

  const region=point?{...point,latitudeDelta:.04,longitudeDelta:.04}:DEFAULT_REGION;

  return <View style={styles.wrap}>
    <View style={styles.notice}><Text style={styles.noticeTitle}>Customer-facing service location</Text><Text style={styles.noticeText}>Use your pickup/service point, not your private home address. Only this service location is shared on the customer map.</Text></View>
    <Text style={styles.label}>SERVICE ADDRESS</Text>
    <TextInput value={address} onChangeText={setAddress} onBlur={()=>emit()} placeholder="Business / pickup location" placeholderTextColor="#A0A7B1" style={styles.input}/>
    <Text style={styles.label}>CITY</Text>
    <TextInput value={city} onChangeText={setCity} onBlur={()=>emit()} placeholder="Jaipur" placeholderTextColor="#A0A7B1" style={styles.input}/>
    <View style={styles.mapWrap}><MapView provider={PROVIDER_GOOGLE} style={StyleSheet.absoluteFill} initialRegion={region} region={region} onPress={e=>selectPoint(e.nativeEvent.coordinate)}>{point&&<Marker coordinate={point}><View style={styles.pin}><Text style={styles.pinText}>●</Text></View></Marker>}</MapView><View style={styles.hint}><Text style={styles.hintText}>Tap map to move the service pin.</Text></View></View>
    <View style={styles.actions}><TouchableOpacity onPress={useCurrent} style={styles.secondary}><Text style={styles.secondaryText}>⌖ Use device location</Text></TouchableOpacity><Text style={styles.status}>{point?'Service location selected':'Set service location on map'}</Text></View>
    {error?<Text style={styles.error}>{error}</Text>:null}
  </View>;
}
const styles=StyleSheet.create({wrap:{marginTop:8},notice:{backgroundColor:'#FFF8EE',borderWidth:1,borderColor:'#F1DFC0',borderRadius:13,padding:11,marginBottom:13},noticeTitle:{fontSize:12,fontWeight:'900',color:C.ink},noticeText:{fontSize:10,color:C.muted,lineHeight:15,marginTop:4},label:{fontSize:9,fontWeight:'900',letterSpacing:1,color:C.muted,marginTop:8,marginBottom:6},input:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:12,paddingHorizontal:12,paddingVertical:11,fontSize:13,color:C.ink},mapWrap:{height:220,borderRadius:18,overflow:'hidden',marginTop:12,backgroundColor:'#E7ECF2'},hint:{position:'absolute',left:12,right:12,bottom:10,backgroundColor:'#FFFFFFE8',padding:8,borderRadius:10},hintText:{fontSize:10,color:C.muted},pin:{width:30,height:30,borderRadius:15,backgroundColor:C.orange,borderWidth:3,borderColor:C.white,alignItems:'center',justifyContent:'center'},pinText:{fontSize:10,color:C.white},actions:{flexDirection:'row',alignItems:'center',gap:10,marginTop:9},secondary:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:11,paddingHorizontal:11,paddingVertical:9},secondaryText:{fontSize:10,fontWeight:'900',color:C.ink},status:{flex:1,fontSize:10,color:C.muted},error:{marginTop:8,backgroundColor:'#FFF0F0',borderRadius:10,padding:9,color:'#B23B3B',fontSize:10}
});
