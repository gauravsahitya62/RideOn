import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const RIDEON_SERVICE_CITY='Udaipur';
const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',bg:'#F6F7F9',line:'#E8EAF0',white:'#FFFFFF',green:'#258565'};

export default function LocationSelector({visible,selectedCity,onConfirm,onCancel,locations,loading=false,error='',onRetry}){
  const [query,setQuery]=useState('');
  const [draft,setDraft]=useState(selectedCity||'');
  useEffect(()=>{if(visible){setDraft(RIDEON_SERVICE_CITY);setQuery('');}},[visible,selectedCity]);
  const options=useMemo(()=>[RIDEON_SERVICE_CITY].filter(city=>city.toLowerCase().includes(query.trim().toLowerCase())),[query]);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
    <View style={styles.shade}><View style={styles.sheet}><View style={styles.handle}/>
      <View style={styles.header}><View><Text style={styles.eyebrow}>RIDEON LOCATION</Text><Text style={styles.title}>Where are you riding?</Text></View><TouchableOpacity onPress={onCancel}><Text style={styles.close}>✕</Text></TouchableOpacity></View>
      <TextInput value={query} onChangeText={setQuery} placeholder="Search available cities" placeholderTextColor="#A0A7B1" style={styles.search}/>
      {loading?<View style={styles.state}><ActivityIndicator color={C.orange}/><Text style={styles.muted}>Loading available locations…</Text></View>:
       error?<View style={styles.state}><Text style={styles.errorTitle}>Could not load locations</Text><Text style={styles.muted}>{error}</Text>{onRetry?<TouchableOpacity onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>:null}</View>:
       options.length?<ScrollView style={{maxHeight:360}} keyboardShouldPersistTaps="handled">{options.map(city=>{const active=city===draft;return <TouchableOpacity key={city} style={[styles.option,active&&styles.optionActive]} onPress={()=>setDraft(city)} accessibilityRole="radio" accessibilityState={{selected:active}}><View style={styles.pin}><Text style={styles.pinText}>⌖</Text></View><View style={{flex:1}}><Text style={styles.city}>{city}</Text><Text style={styles.muted}>{active?'Selected location':'Vehicle search will use this city'}</Text></View><Text style={[styles.check,!active&&{color:'transparent'}]}>✓</Text></TouchableOpacity>})}</ScrollView>:
       <View style={styles.state}><Text style={styles.errorTitle}>No matching locations</Text><Text style={styles.muted}>{query?'Try another search.':'No locations are available from current fleet data.'}</Text></View>}
      <View style={styles.actions}><TouchableOpacity style={styles.secondary} onPress={onCancel}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={[styles.primary,!draft&&styles.disabled]} disabled={!draft} onPress={()=>onConfirm?.(draft)}><Text style={styles.primaryText}>Use {draft||'location'}</Text></TouchableOpacity></View>
    </View></View>
  </Modal>;
}

const styles=StyleSheet.create({
  shade:{flex:1,backgroundColor:'#11182777',justifyContent:'flex-end'},sheet:{maxHeight:'86%',backgroundColor:C.bg,borderTopLeftRadius:26,borderTopRightRadius:26,padding:20,paddingBottom:24},
  handle:{width:44,height:5,borderRadius:5,backgroundColor:'#D6DAE1',alignSelf:'center',marginBottom:17},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16},
  eyebrow:{fontSize:9,fontWeight:'900',letterSpacing:1.3,color:C.orange,marginBottom:6},title:{fontSize:25,fontWeight:'900',color:C.ink},close:{fontSize:19,color:C.muted,padding:8},
  search:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:14,paddingHorizontal:14,paddingVertical:12,fontSize:14,color:C.ink,marginBottom:12},
  option:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:16,padding:14,marginBottom:9},optionActive:{borderColor:C.orange,backgroundColor:'#FFF6F2'},
  pin:{width:38,height:38,borderRadius:19,backgroundColor:'#FFF0E9',alignItems:'center',justifyContent:'center'},pinText:{fontSize:18,color:C.orange},city:{fontSize:14,fontWeight:'900',color:C.ink},muted:{fontSize:11,color:C.muted,lineHeight:17,marginTop:3},check:{fontSize:18,color:C.green,fontWeight:'900'},
  state:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:16,padding:20,alignItems:'center',justifyContent:'center',minHeight:140},errorTitle:{fontSize:14,fontWeight:'900',color:C.ink},
  retry:{marginTop:12,paddingHorizontal:14,paddingVertical:9,borderRadius:12,backgroundColor:C.orange},retryText:{color:C.white,fontWeight:'900'},
  actions:{flexDirection:'row',gap:9,marginTop:14},secondary:{flex:1,backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:14,paddingVertical:14,alignItems:'center'},secondaryText:{color:C.ink,fontWeight:'900'},
  primary:{flex:1,backgroundColor:C.orange,borderRadius:14,paddingVertical:14,alignItems:'center'},primaryText:{color:C.white,fontWeight:'900'},disabled:{opacity:.45}
});