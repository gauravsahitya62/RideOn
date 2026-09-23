import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',line:'#E8EAF0',white:'#FFFFFF',green:'#258565'};
export default function PaymentMethodSelector({disabled=false}){
 return <View style={styles.card}>
  <View style={styles.head}><View style={{flex:1}}><Text style={styles.kicker}>PAYMENT</Text><Text style={styles.title}>Paytm</Text></View><Text style={styles.badge}>PRIMARY</Text></View>
  <Text style={styles.note}>Pay the exact server-calculated rental amount and refundable security deposit. RideOn confirms payment only after verified provider state.</Text>
  <TouchableOpacity disabled={disabled} style={styles.option} accessibilityRole="radio" accessibilityState={{selected:true,disabled}}>
   <View style={styles.radio}><Text style={styles.dot}>●</Text></View>
   <View style={{flex:1}}><Text style={styles.optionTitle}>Paytm</Text><Text style={styles.sub}>Rental payment + refundable security deposit</Text></View>
  </TouchableOpacity>
 </View>;
}
const styles=StyleSheet.create({
 card:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:18,padding:16,marginBottom:14},
 head:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:10},
 kicker:{fontSize:9,letterSpacing:1.1,fontWeight:'900',color:C.muted},
 title:{fontSize:18,fontWeight:'900',color:C.ink,marginTop:4},
 badge:{fontSize:8,fontWeight:'900',letterSpacing:.7,color:C.green,backgroundColor:'#EAF6F0',paddingHorizontal:8,paddingVertical:5,borderRadius:9},
 note:{fontSize:11,color:C.muted,lineHeight:17,marginTop:9,marginBottom:12},
 option:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#FFF7F3',borderWidth:1,borderColor:C.orange,borderRadius:14,padding:13},
 radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:C.orange,alignItems:'center',justifyContent:'center'},
 dot:{fontSize:12,color:C.orange},
 optionTitle:{fontSize:13,fontWeight:'900',color:C.ink},
 sub:{fontSize:10,color:C.muted,lineHeight:15,marginTop:2}
});
