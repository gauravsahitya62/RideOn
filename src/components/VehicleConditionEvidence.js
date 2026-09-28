import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Alert,Image,ScrollView,Text,TouchableOpacity,View} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {rideOnApi} from '../services/api';

const toBase64=async(uri)=>{
  const response=await fetch(uri);
  const blob=await response.blob();
  return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onloadend=()=>resolve(String(reader.result||'').split(',').pop()||'');
    reader.onerror=reject;
    reader.readAsDataURL(blob);
  });
};

export default function VehicleConditionEvidence({bookingId,phase='delivery',latitude=null,longitude=null,onSaved,actor='customer'}){
  const [data,setData]=useState({evidence:[],reports:[]});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const [selectedStatus,setSelectedStatus]=useState(phase==='delivery'?'no_damage':'no_damage');
  const [damageNotes,setDamageNotes]=useState('');

  const load=useCallback(async()=>{
    if(!bookingId)return;
    setLoading(true);
    try{const result=await rideOnApi.getConditionEvidence(bookingId);setData({evidence:result?.evidence||[],reports:result?.reports||[]});}
    catch(error){setStatus(error?.message||'Could not load vehicle condition evidence.');}
    finally{setLoading(false);}
  },[bookingId]);

  useEffect(()=>{load();},[load]);

  const phaseEvidence=useMemo(()=>data.evidence.filter(x=>x.phase===phase),[data.evidence,phase]);
  const deliveryBaseline=useMemo(()=>data.evidence.filter(x=>x.phase==='delivery'),[data.evidence]);
  const hasImages=phaseEvidence.some(x=>x.mediaType==='image');
  const capture=async()=>{
    if(busy)return;
    setStatus('');
    try{
      const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();
      if(permission.status!=='granted'){setStatus('');Alert.alert('Photos permission required','Allow RideOn to access photos and videos so you can record vehicle condition.');return;}
      const result=await ImagePicker.launchImageLibraryAsync({
        mediaTypes:ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection:true,
        selectionLimit:8,
        quality:.75,
        videoMaxDuration:30,
      });
      if(result.canceled)return;
      setBusy(true);
      for(const asset of result.assets||[]){
        const mediaType=String(asset.type||asset.mimeType||'').toLowerCase().includes('video')?'video':'image';
        const contentType=asset.mimeType||(mediaType==='video'?'video/mp4':'image/jpeg');
        const base64=await toBase64(asset.uri);
        if(base64.length>21_000_000)throw new Error('One selected file is too large. Please choose a shorter video or smaller photo.');
        await rideOnApi.uploadConditionEvidence(bookingId,{phase,mediaType,base64,contentType,capturedAt:new Date(asset.creationTime||Date.now()).toISOString(),latitude,longitude,metadata:{fileName:asset.fileName||null,width:asset.width||null,height:asset.height||null,durationMs:asset.duration||null}});
      }
      await load();
      setStatus(`${(result.assets||[]).length} evidence item${(result.assets||[]).length===1?'':'s'} added.`);
    }catch(error){setStatus(error?.message||'Evidence upload failed. Please try again.');}
    finally{setBusy(false);}
  };

  const submitReport=async()=>{
    if(busy)return;
    setBusy(true);setStatus('');
    try{
      const report=await rideOnApi.submitConditionReport(bookingId,{phase,conditionStatus:selectedStatus,damageNotes,evidenceCount:phaseEvidence.length,acknowledged:true,capturedAt:new Date().toISOString(),latitude,longitude});
      await load();
      onSaved?.(report?.report);
      setStatus('Vehicle condition recorded.');
    }catch(error){setStatus(error?.message||'Vehicle condition could not be saved.');}
    finally{setBusy(false);}
  };

  const isDriver=actor==='driver';
  const title=isDriver
    ? (phase==='delivery'?'Record handover condition':'Record pickup condition')
    : (phase==='delivery'?'Check the vehicle before you accept it':'Record the vehicle condition at pickup');
  const subtitle=isDriver
    ? (phase==='delivery'?'Capture the vehicle condition at handover. Record visible damage before completing delivery.':'Capture the vehicle condition when you collect the vehicle. Record any new damage before completing pickup.')
    : (phase==='delivery'?'Compare the vehicle with the delivery evidence, record any existing damage, and keep your own photos/video.':'Capture the vehicle again before it leaves. RideOn will keep this evidence alongside the delivery record.');
  const canSubmit=phaseEvidence.length>0;
  return <View style={{backgroundColor:'#fff',borderRadius:20,borderWidth:1,borderColor:'#E8E2DA',padding:16,marginTop:12}}>
    <Text style={{fontSize:18,fontWeight:'900',color:'#171A1F'}}>{title}</Text>
    <Text style={{fontSize:11,color:'#707783',lineHeight:17,marginTop:5}}>{subtitle}</Text>
    {phase==='pickup'&&deliveryBaseline.length>0?<View style={{backgroundColor:'#F7F5F1',borderRadius:14,padding:11,marginTop:12}}><Text style={{fontSize:9,fontWeight:'900',letterSpacing:1,color:'#E56A3D'}}>DELIVERY BASELINE</Text><Text style={{fontSize:11,color:'#4F5660',lineHeight:16,marginTop:4}}>Review the delivery photos/video before recording the pickup condition. {deliveryBaseline.length} item{deliveryBaseline.length===1?'':'s'} available.</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginTop:9}}>{deliveryBaseline.map(item=>item.mediaType==='image'?<Image key={item.id} source={{uri:item.url}} style={{width:74,height:74,borderRadius:10,marginRight:8}}/>:<View key={item.id} style={{width:74,height:74,borderRadius:10,marginRight:8,backgroundColor:'#E8E2DA',alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:22}}>▶</Text><Text style={{fontSize:8,fontWeight:'900',color:'#4F5660'}}>VIDEO</Text></View>)}</ScrollView></View>:null}
    <TouchableOpacity onPress={capture} disabled={busy} style={{height:50,borderRadius:14,backgroundColor:'#171A1F',alignItems:'center',justifyContent:'center',marginTop:13}}><Text style={{color:'#fff',fontSize:12,fontWeight:'900'}}>{busy?'Uploading…':'＋ Add photos / video'}</Text></TouchableOpacity>
    {loading?<View style={{padding:18,alignItems:'center'}}><ActivityIndicator color="#E56A3D"/></View>:phaseEvidence.length>0?<><Text style={{fontSize:9,fontWeight:'900',letterSpacing:1,color:'#707783',marginTop:14}}>YOUR {phase.toUpperCase()} EVIDENCE · {phaseEvidence.length}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginTop:9}}>{phaseEvidence.map(item=>item.mediaType==='image'?<Image key={item.id} source={{uri:item.url}} style={{width:82,height:82,borderRadius:11,marginRight:8}}/>:<View key={item.id} style={{width:82,height:82,borderRadius:11,marginRight:8,backgroundColor:'#E8E2DA',alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:25}}>▶</Text><Text style={{fontSize:8,fontWeight:'900'}}>VIDEO</Text></View>)}</ScrollView></>:<Text style={{fontSize:10,color:'#8A919B',marginTop:12}}>Add clear photos of all sides, wheels, dashboard/odometer and any visible damage.</Text>}
    <Text style={{fontSize:9,fontWeight:'900',letterSpacing:1,color:'#707783',marginTop:15,marginBottom:8}}>CONDITION</Text>
    <View style={{flexDirection:'row',gap:7,flexWrap:'wrap'}}>
      {(phase==='delivery'?[['no_damage','No damage'],['existing_damage','Existing damage']]:[['no_damage','No new damage'],['new_damage','New damage']]).map(([value,label])=><TouchableOpacity key={value} onPress={()=>setSelectedStatus(value)} style={{paddingHorizontal:11,paddingVertical:9,borderRadius:18,borderWidth:1,borderColor:selectedStatus===value?'#E56A3D':'#E8E2DA',backgroundColor:selectedStatus===value?'#FFF0E9':'#fff'}}><Text style={{fontSize:10,fontWeight:'900',color:selectedStatus===value?'#E56A3D':'#5F6670'}}>{selectedStatus===value?'✓ ':''}{label}</Text></TouchableOpacity>)}
    </View>
    {(selectedStatus==='existing_damage'||selectedStatus==='new_damage')&&<TextInputLike value={damageNotes} onChange={setDamageNotes}/>}
    <TouchableOpacity onPress={submitReport} disabled={busy||!canSubmit} style={{height:48,borderRadius:14,backgroundColor:canSubmit?'#E56A3D':'#D7D2CA',alignItems:'center',justifyContent:'center',marginTop:12}}><Text style={{color:'#fff',fontSize:11,fontWeight:'900'}}>{busy?'Saving…':phase==='delivery'?'Confirm vehicle condition':'Confirm pickup condition'}</Text></TouchableOpacity>
    {status?<Text style={{fontSize:10,fontWeight:'800',color:status.includes('failed')||status.includes('could')?'#C94B4B':'#4B806A',lineHeight:15,marginTop:9}}>{status}</Text>:null}
  </View>;
}

function TextInputLike({value,onChange}){
  const {TextInput}=require('react-native');
  return <TextInput value={value} onChangeText={onChange} multiline placeholder="Describe the damage and where it is located…" placeholderTextColor="#9AA1AB" style={{marginTop:10,minHeight:78,borderWidth:1,borderColor:'#E8E2DA',borderRadius:13,padding:11,fontSize:11,color:'#171A1F',textAlignVertical:'top'}}/>;
}
