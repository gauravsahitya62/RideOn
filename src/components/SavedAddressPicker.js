import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',line:'#E8EAF0',white:'#FFFFFF',green:'#258565'};

export default function SavedAddressPicker({addresses=[],selectedId,onSelect,onAdd}){
  return <View>
    <View style={styles.header}><View><Text style={styles.label}>SAVED DELIVERY ADDRESSES</Text><Text style={styles.sub}>Local prototype addresses</Text></View>{onAdd?<TouchableOpacity onPress={onAdd}><Text style={styles.add}>+ Add</Text></TouchableOpacity>:null}</View>
    {addresses.length?addresses.map(address=>{const active=selectedId===address.id;return <TouchableOpacity key={address.id} style={[styles.card,active&&styles.active]} onPress={()=>onSelect?.(address)} accessibilityRole="radio" accessibilityState={{selected:active}}>
      <View style={{flex:1}}><View style={styles.titleRow}><Text style={styles.title}>{address.label||'Saved address'}</Text>{address.default?<Text style={styles.default}>DEFAULT</Text>:null}</View>
      <Text style={styles.body}>{address.recipient} · {address.phone}</Text><Text style={styles.sub}>{[address.street,address.area,address.city].filter(Boolean).join(', ')}{address.postalCode?` — ${address.postalCode}`:''}</Text></View>
      <Text style={[styles.check,!active&&{color:'transparent'}]}>✓</Text>
    </TouchableOpacity>}):<View style={styles.empty}><Text style={styles.title}>No saved addresses</Text><Text style={styles.sub}>Add one here or type a new delivery address above.</Text></View>}
  </View>;
}

const styles=StyleSheet.create({
 header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:9},label:{fontSize:10,fontWeight:'900',letterSpacing:.7,color:'#596371'},sub:{fontSize:10,color:C.muted,lineHeight:16,marginTop:3},add:{fontSize:12,fontWeight:'900',color:C.orange,paddingVertical:5},
 card:{flexDirection:'row',alignItems:'center',gap:11,backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:15,padding:13,marginBottom:8},active:{borderColor:C.orange,backgroundColor:'#FFF6F2'},titleRow:{flexDirection:'row',alignItems:'center',gap:7,marginBottom:4},title:{fontSize:13,fontWeight:'900',color:C.ink},body:{fontSize:11,color:C.ink},default:{fontSize:7,fontWeight:'900',color:C.green,backgroundColor:'#EAF6F0',paddingHorizontal:6,paddingVertical:3,borderRadius:8},check:{fontSize:18,color:C.green,fontWeight:'900'},empty:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:15,padding:14}
});