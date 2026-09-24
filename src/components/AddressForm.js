import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',bg:'#F6F7F9',line:'#E8EAF0',white:'#FFFFFF'};
const empty={label:'',recipient:'',phone:'',street:'',area:'',city:'',postalCode:'',instructions:''};

export default function AddressForm({address,onSave,onCancel}){
  const [draft,setDraft]=useState({...empty}),[error,setError]=useState('');
  useEffect(()=>{setDraft({...empty,...(address||{})});setError('');},[address]);
  const update=(key,value)=>{setDraft(current=>({...current,[key]:value}));setError('');};
  const save=()=>{const required=['label','recipient','phone','street','area','city','postalCode'];if(required.some(key=>!String(draft[key]||'').trim()))return setError('Complete all required address fields.');if(draft.phone.replace(/\D/g,'').length<10)return setError('Enter a valid phone number.');if(!/^\d{6}$/.test(draft.postalCode))return setError('Postal code must be 6 digits.');onSave?.({...draft,phone:draft.phone.trim(),postalCode:draft.postalCode.trim()});};
  const Field=({label,value,onChangeText,placeholder,keyboardType})=><View style={styles.fieldWrap}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#A0A7B1" keyboardType={keyboardType} style={styles.field}/></View>;
  return <View style={{flex:1}}><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="always" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
    <Text style={styles.eyebrow}>{address?'EDIT SAVED ADDRESS':'NEW SAVED ADDRESS'}</Text><Text style={styles.title}>{address?'Update delivery address':'Add delivery address'}</Text><Text style={styles.sub}>Saved addresses stay local to this prototype and are not synced to the booking server.</Text>
    <Field label="LABEL" value={draft.label} onChangeText={v=>update('label',v)} placeholder="Home / Work"/>
    <Field label="RECIPIENT" value={draft.recipient} onChangeText={v=>update('recipient',v)} placeholder="Person receiving the ride"/>
    <Field label="CONTACT NUMBER" value={draft.phone} onChangeText={v=>update('phone',v.replace(/[^0-9+ ]/g,''))} placeholder="10-digit phone number" keyboardType="phone-pad"/>
    <Field label="ADDRESS LINE" value={draft.street} onChangeText={v=>update('street',v)} placeholder="House number and street"/>
    <Field label="APARTMENT / FLOOR / LANDMARK" value={draft.area} onChangeText={v=>update('area',v)} placeholder="Area, apartment, floor or landmark"/>
    <Field label="CITY" value={draft.city} onChangeText={v=>update('city',v)} placeholder="City"/>
    <Field label="POSTAL CODE" value={draft.postalCode} onChangeText={v=>update('postalCode',v.replace(/\D/g,'').slice(0,6))} placeholder="6-digit postal code" keyboardType="number-pad"/>
    <Field label="DELIVERY INSTRUCTIONS (OPTIONAL)" value={draft.instructions} onChangeText={v=>update('instructions',v)} placeholder="Gate, security desk, timing notes…"/>
    {error?<View style={styles.error}><Text style={styles.errorText}>{error}</Text></View>:null}
    <View style={styles.actions}><TouchableOpacity style={styles.secondary} onPress={onCancel}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={styles.primary} onPress={save}><Text style={styles.primaryText}>{address?'Save changes':'Save address'}</Text></TouchableOpacity></View>
  </ScrollView></View>;
}
const styles=StyleSheet.create({
  page:{padding:20,paddingBottom:40,backgroundColor:C.bg},eyebrow:{fontSize:9,fontWeight:'900',letterSpacing:1.3,color:C.orange,marginBottom:7},title:{fontSize:27,fontWeight:'900',color:C.ink},sub:{fontSize:12,color:C.muted,lineHeight:18,marginTop:7,marginBottom:18},
  fieldWrap:{marginBottom:13},label:{fontSize:10,fontWeight:'900',letterSpacing:.5,color:'#596371',marginBottom:7},field:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:13,paddingHorizontal:14,paddingVertical:12,fontSize:14,color:C.ink},
  error:{backgroundColor:'#FFF0F0',borderWidth:1,borderColor:'#F4CCCC',borderRadius:13,padding:11,marginTop:3},errorText:{color:'#B23B3B',fontSize:12,fontWeight:'800'},actions:{flexDirection:'row',gap:9,marginTop:8},
  secondary:{flex:1,backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:14,paddingVertical:14,alignItems:'center'},secondaryText:{color:C.ink,fontWeight:'900'},primary:{flex:1,backgroundColor:C.orange,borderRadius:14,paddingVertical:14,alignItems:'center'},primaryText:{color:C.white,fontWeight:'900'}
});