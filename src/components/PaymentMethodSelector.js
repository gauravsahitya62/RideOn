import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',line:'#E8EAF0',white:'#FFFFFF'};
export default function PaymentMethodSelector({value,onChange,disabled=false}){
 const selected=value==='demo';
 return <View style={styles.card}>
  <View style={styles.head}><View style={{flex:1}}><Text style={styles.kicker}>PAYMENT METHOD</Text><Text style={styles.title}>No live payment provider connected</Text></View><Text style={styles.unavailable}>UNAVAILABLE</Text></View>
  <TouchableOpacity disabled={disabled} onPress={()=>onChange?.('demo')} style={[styles.option,selected&&styles.active]} accessibilityRole="radio" accessibilityLabel="Demo payment, not charged" accessibilityState={{selected,disabled}}>
   <View style={styles.radio}><Text style={{fontSize:12,color:selected?C.orange:'transparent'}}>●</Text></View>
   <View style={{flex:1}}><Text style={styles.optionTitle}>Demo payment — not charged</Text><Text style={styles.sub}>For review-flow only. No card, CVV, UPI, wallet, or bank details are collected and no payment is processed.</Text></View>
  </TouchableOpacity>
 </View>;
}
const styles=StyleSheet.create({
 card:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:18,padding:16,marginBottom:14},head:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:10},kicker:{fontSize:9,letterSpacing:1.1,fontWeight:'900',color:C.muted},title:{fontSize:14,fontWeight:'900',color:C.ink,marginTop:4},unavailable:{fontSize:8,fontWeight:'900',letterSpacing:.7,color:'#8A5A1F',backgroundColor:'#FFF5E8',paddingHorizontal:8,paddingVertical:5,borderRadius:9},option:{flexDirection:'row',alignItems:'flex-start',gap:10,backgroundColor:'#F9FAFB',borderWidth:1,borderColor:C.line,borderRadius:14,padding:12,marginTop:12},active:{borderColor:C.orange,backgroundColor:'#FFF7F3'},radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:C.orange,alignItems:'center',justifyContent:'center'},optionTitle:{fontSize:12,fontWeight:'900',color:C.ink},sub:{fontSize:10,color:C.muted,lineHeight:16,marginTop:3}
});