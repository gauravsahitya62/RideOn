import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',line:'#E8EAF0',white:'#FFFFFF',green:'#258565'};
const money=v=>`₹${Number(v||0).toLocaleString('en-IN')}`;
export default function CheckoutSummary({vehicle,date,pickupTime,returnDate,returnTime,duration,city,delivery,address,quote,fallbackSubtotal=0}){
 const rental=quote?.rental,deliveryFee=quote?.deliveryFee,platformFee=quote?.platformFee,securityDeposit=quote?.securityDeposit,total=quote?.total;
 return <View style={styles.card}>
  <View style={styles.head}><Text style={styles.kicker}>BOOKING SUMMARY</Text>{quote?<Text style={styles.badge}>SERVER QUOTE</Text>:null}</View>
  <Text style={styles.vehicle}>{vehicle?.emoji||'🚘'} {vehicle?.name||'Selected vehicle'}</Text>
  <Text style={styles.meta}>{date||'Pickup date not set'} {pickupTime||''} → {returnDate||'Return date not set'} {returnTime||''}</Text>
  <Text style={styles.meta}>{duration?duration+' day'+(duration===1?'':'s')+' · ':''}{city||'Location not set'}</Text>
  <View style={styles.divider}/><Text style={styles.label}>{delivery?'DOORSTEP DELIVERY':'SELF PICKUP'}</Text>
  <Text style={styles.address}>{delivery?(address||'Delivery address not set'):'Collect the vehicle yourself'}</Text>
  <View style={styles.divider}/>
  {quote?<>{rental!=null&&<Line label="Rental" value={money(rental)}/>}
   {deliveryFee!=null&&<Line label="Delivery" value={money(deliveryFee)}/>}
   {platformFee!=null&&<Line label="Platform fee" value={money(platformFee)}/>}
   {securityDeposit!=null&&securityDeposit>0&&<Line label="Security deposit (refundable)" value={money(securityDeposit)}/>}
   {total!=null?<><View style={styles.divider}/><Line label="Total payable" value={money(total)} strong/></>:<Text style={styles.note}>The server quote did not provide a payable total.</Text>}
  </>:<><Line label="Rental subtotal" value={money(fallbackSubtotal)}/><Text style={styles.note}>Waiting for the server quote.</Text></>}
 </View>;
}
function Line({label,value,strong=false}){return <View style={styles.line}><Text style={[styles.lineLabel,strong&&styles.strongLabel]}>{label}</Text><Text style={[styles.value,strong&&styles.strongValue]}>{value}</Text></View>;}
const styles=StyleSheet.create({card:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:18,padding:16,marginBottom:14},head:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},kicker:{fontSize:9,letterSpacing:1.1,fontWeight:'900',color:C.muted},badge:{fontSize:8,letterSpacing:.8,fontWeight:'900',color:C.green,backgroundColor:'#EAF6F0',paddingHorizontal:8,paddingVertical:5,borderRadius:10},vehicle:{fontSize:15,fontWeight:'900',color:C.ink,marginTop:10},meta:{fontSize:11,color:C.muted,lineHeight:17,marginTop:3},divider:{height:1,backgroundColor:C.line,marginVertical:11},label:{fontSize:9,fontWeight:'900',letterSpacing:.7,color:C.muted},address:{fontSize:12,color:C.ink,lineHeight:18,marginTop:4},line:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:6},lineLabel:{fontSize:12,color:C.muted},value:{fontSize:12,fontWeight:'800',color:C.ink},strongLabel:{fontSize:14,color:C.ink,fontWeight:'900'},strongValue:{fontSize:20,color:C.ink,fontWeight:'900'},note:{fontSize:10,color:C.muted,lineHeight:16,marginTop:5}});
