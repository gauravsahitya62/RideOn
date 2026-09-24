import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',line:'#E8EAF0',white:'#FFFFFF',green:'#258565'};

export default function PaymentMethodSelector({disabled=false}){
 return <View style={styles.card}>
  <View style={styles.head}>
   <View style={{flex:1}}>
    <Text style={styles.kicker}>PAYMENT METHOD</Text>
    <Text style={styles.title}>UPI</Text>
   </View>
   <View style={styles.badge}><Text style={styles.badgeText}>PRIMARY</Text></View>
  </View>
  <Text style={styles.note}>Pay the exact server-calculated amount using any supported UPI app. Your payment is confirmed only after RideOn verifies the provider transaction.</Text>
  <TouchableOpacity disabled={disabled} style={styles.option} accessibilityRole="radio" accessibilityState={{selected:true,disabled}}>
   <View style={styles.upiMark}><Text style={styles.upiMarkText}>UPI</Text></View>
   <View style={{flex:1,minWidth:0}}>
    <Text style={styles.optionTitle}>UPI payment</Text>
    <Text style={styles.sub}>Rental amount + refundable security deposit</Text>
   </View>
   <View style={styles.radio}><View style={styles.dot}/></View>
  </TouchableOpacity>
 </View>;
}
const styles=StyleSheet.create({
 card:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:24,padding:18,marginBottom:16,shadowColor:'#17202D',shadowOpacity:.04,shadowRadius:12,shadowOffset:{width:0,height:4},elevation:2},
 head:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:10},
 kicker:{fontSize:10,letterSpacing:1.5,fontWeight:'900',color:C.muted},
 title:{fontSize:25,fontWeight:'900',color:C.ink,marginTop:3},
 badge:{backgroundColor:'#EAF6F0',paddingHorizontal:10,paddingVertical:6,borderRadius:12},
 badgeText:{fontSize:8,fontWeight:'900',letterSpacing:.8,color:C.green},
 note:{fontSize:12,color:C.muted,lineHeight:18,marginTop:10,marginBottom:14},
 option:{flexDirection:'row',alignItems:'center',gap:11,backgroundColor:'#FFF7F3',borderWidth:1.5,borderColor:C.orange,borderRadius:17,padding:13},
 upiMark:{width:43,height:43,borderRadius:13,backgroundColor:C.orange,alignItems:'center',justifyContent:'center'},
 upiMarkText:{fontSize:11,fontWeight:'900',color:C.white,letterSpacing:-.3},
 radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:C.orange,alignItems:'center',justifyContent:'center'},
 dot:{width:10,height:10,borderRadius:5,backgroundColor:C.orange},
 optionTitle:{fontSize:14,fontWeight:'900',color:C.ink},
 sub:{fontSize:10,color:C.muted,lineHeight:15,marginTop:3}
});