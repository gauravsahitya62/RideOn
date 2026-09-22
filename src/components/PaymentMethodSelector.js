import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',line:'#E8EAF0',white:'#FFFFFF',green:'#258565'};
const OPTIONS=[
 {id:'upi',title:'UPI',sub:'Pay with a UPI app'},
 {id:'card',title:'Cards',sub:'Credit or debit card'},
 {id:'netbanking',title:'Netbanking',sub:'Use your bank login'},
 {id:'wallet',title:'Wallets',sub:'Available wallets at checkout'},
];
export default function PaymentMethodSelector({value,onChange,disabled=false}){
 const selected=value||'upi';
 return <View style={styles.card}>
  <View style={styles.head}>
   <View style={{flex:1}}><Text style={styles.kicker}>PAYMENT METHOD</Text><Text style={styles.title}>Secure checkout</Text></View>
   <Text style={styles.badge}>RAZORPAY</Text>
  </View>
  <Text style={styles.note}>Your final amount comes from the RideOn server quote. Payment is verified on the server before a booking is shown as paid.</Text>
  <View style={styles.grid}>
   {OPTIONS.map(option=>{
    const active=selected===option.id;
    return <TouchableOpacity key={option.id} disabled={disabled} onPress={()=>onChange?.(option.id)} style={[styles.option,active&&styles.active]} accessibilityRole="radio" accessibilityLabel={`${option.title} payment method`} accessibilityState={{selected:active,disabled}}>
      <View style={styles.radio}><Text style={{fontSize:12,color:active?C.orange:'transparent'}}>●</Text></View>
      <View style={{flex:1}}><Text style={styles.optionTitle}>{option.title}</Text><Text style={styles.sub}>{option.sub}</Text></View>
    </TouchableOpacity>;
   })}
  </View>
 </View>;
}
const styles=StyleSheet.create({
 card:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:18,padding:16,marginBottom:14},
 head:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:10},
 kicker:{fontSize:9,letterSpacing:1.1,fontWeight:'900',color:C.muted},
 title:{fontSize:14,fontWeight:'900',color:C.ink,marginTop:4},
 badge:{fontSize:8,fontWeight:'900',letterSpacing:.7,color:C.green,backgroundColor:'#EAF6F0',paddingHorizontal:8,paddingVertical:5,borderRadius:9},
 note:{fontSize:10,color:C.muted,lineHeight:16,marginTop:9},
 grid:{gap:8,marginTop:12},
 option:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#F9FAFB',borderWidth:1,borderColor:C.line,borderRadius:14,padding:12},
 active:{borderColor:C.orange,backgroundColor:'#FFF7F3'},
 radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:C.orange,alignItems:'center',justifyContent:'center'},
 optionTitle:{fontSize:12,fontWeight:'900',color:C.ink},
 sub:{fontSize:10,color:C.muted,lineHeight:15,marginTop:2}
});