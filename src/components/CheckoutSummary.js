import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',line:'#E8EAF0',white:'#FFFFFF',green:'#258565',soft:'#F8F9FB'};
const money=v=>`₹${Number(v||0).toLocaleString('en-IN')}`;

export default function CheckoutSummary({vehicle,date,pickupTime,returnDate,returnTime,duration,city,delivery,address,quote,fallbackSubtotal=0}){
 const rental=quote?.rental,deliveryFee=quote?.deliveryFee,platformFee=quote?.platformFee,securityDeposit=quote?.securityDeposit,total=quote?.total;
 return <View style={styles.card}>
  <View style={styles.head}>
   <View><Text style={styles.kicker}>BOOKING SUMMARY</Text><Text style={styles.headSub}>Your rental details</Text></View>
   {quote?<Text style={styles.badge}>SERVER QUOTE</Text>:null}
  </View>

  <View style={styles.vehicleRow}>
   <View style={styles.vehicleIcon}><Text style={styles.vehicleEmoji}>{vehicle?.emoji||'🚘'}</Text></View>
   <View style={{flex:1,minWidth:0}}>
    <Text style={styles.vehicle} numberOfLines={1}>{vehicle?.name||'Selected vehicle'}</Text>
    <Text style={styles.meta}>{duration?duration+' day'+(duration===1?'':'s'):''}{city?' · '+city:''}</Text>
   </View>
  </View>

  <View style={styles.schedule}>
   <View style={styles.scheduleItem}><Text style={styles.scheduleLabel}>PICKUP</Text><Text style={styles.scheduleValue}>{date||'—'}</Text><Text style={styles.scheduleTime}>{pickupTime||'—'}</Text></View>
   <Text style={styles.arrow}>→</Text>
   <View style={styles.scheduleItem}><Text style={styles.scheduleLabel}>RETURN</Text><Text style={styles.scheduleValue}>{returnDate||'—'}</Text><Text style={styles.scheduleTime}>{returnTime||'—'}</Text></View>
  </View>

  <View style={styles.deliveryBox}>
   <View style={styles.deliveryIcon}><Text>{delivery?'⌖':'⌂'}</Text></View>
   <View style={{flex:1,minWidth:0}}><Text style={styles.label}>{delivery?'DOORSTEP DELIVERY':'SELF PICKUP'}</Text><Text style={styles.address} numberOfLines={2}>{delivery?(address||'Delivery address not set'):'Collect the vehicle yourself'}</Text></View>
  </View>

  <View style={styles.divider}/>
  {quote?<>{rental!=null&&<Line label="Rental" value={money(rental)}/>}
   {deliveryFee!=null&&<Line label="Delivery" value={money(deliveryFee)}/>}
   {platformFee!=null&&<Line label="Platform fee" value={money(platformFee)}/>}
   {securityDeposit!=null&&securityDeposit>0&&<Line label="Security deposit" helper="Refundable" value={money(securityDeposit)}/>}
   {total!=null?<><View style={styles.totalDivider}/><View style={styles.totalRow}><View><Text style={styles.totalLabel}>Total payable</Text><Text style={styles.totalHint}>Includes refundable security deposit</Text></View><Text style={styles.totalValue}>{money(total)}</Text></View></>:<Text style={styles.note}>The server quote did not provide a payable total.</Text>}
  </>:<><Line label="Rental subtotal" value={money(fallbackSubtotal)}/><Text style={styles.note}>Waiting for the server quote.</Text></>}
 </View>;
}

function Line({label,value,helper}){return <View style={styles.line}><View style={{flex:1,minWidth:0}}><Text style={styles.lineLabel}>{label}</Text>{helper?<Text style={styles.helper}>{helper}</Text>:null}</View><Text style={styles.value}>{value}</Text></View>;}

const styles=StyleSheet.create({
 card:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:24,padding:18,marginBottom:16,shadowColor:'#17202D',shadowOpacity:.04,shadowRadius:12,shadowOffset:{width:0,height:4},elevation:2},
 head:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},
 kicker:{fontSize:10,letterSpacing:1.5,fontWeight:'900',color:C.muted},
 headSub:{fontSize:12,color:C.muted,marginTop:4},
 badge:{fontSize:8,letterSpacing:.9,fontWeight:'900',color:C.green,backgroundColor:'#EAF6F0',paddingHorizontal:9,paddingVertical:6,borderRadius:12},
 vehicleRow:{flexDirection:'row',alignItems:'center',gap:11,marginTop:16},
 vehicleIcon:{width:48,height:48,borderRadius:15,backgroundColor:'#FFF4EF',alignItems:'center',justifyContent:'center'},
 vehicleEmoji:{fontSize:26},
 vehicle:{fontSize:17,fontWeight:'900',color:C.ink},
 meta:{fontSize:12,color:C.muted,marginTop:4},
 schedule:{flexDirection:'row',alignItems:'center',backgroundColor:C.soft,borderRadius:16,padding:13,marginTop:15},
 scheduleItem:{flex:1,minWidth:0},
 scheduleLabel:{fontSize:8,fontWeight:'900',letterSpacing:1.1,color:C.muted},
 scheduleValue:{fontSize:12,fontWeight:'800',color:C.ink,marginTop:4},
 scheduleTime:{fontSize:11,color:C.muted,marginTop:2},
 arrow:{fontSize:18,fontWeight:'900',color:C.orange,paddingHorizontal:8},
 deliveryBox:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#FFFAF7',borderWidth:1,borderColor:'#F7E4DB',borderRadius:16,padding:13,marginTop:12},
 deliveryIcon:{width:34,height:34,borderRadius:11,backgroundColor:'#FFF0E9',alignItems:'center',justifyContent:'center'},
 label:{fontSize:8,fontWeight:'900',letterSpacing:1.1,color:C.muted},
 address:{fontSize:12,color:C.ink,lineHeight:17,marginTop:3},
 divider:{height:1,backgroundColor:C.line,marginVertical:15},
 line:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:6},
 lineLabel:{fontSize:12,color:C.muted},
 helper:{fontSize:9,color:C.green,fontWeight:'700',marginTop:2},
 value:{fontSize:13,fontWeight:'800',color:C.ink},
 totalDivider:{height:1,backgroundColor:C.line,marginTop:10,marginBottom:13},
 totalRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12},
 totalLabel:{fontSize:16,fontWeight:'900',color:C.ink},
 totalHint:{fontSize:9,color:C.muted,marginTop:3},
 totalValue:{fontSize:23,fontWeight:'900',color:C.ink},
 note:{fontSize:10,color:C.muted,lineHeight:16,marginTop:5}
});