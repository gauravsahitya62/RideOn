import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',line:'#E8EAF0',white:'#FFFFFF',green:'#258565'};
const money=value=>`₹${Number(value||0).toLocaleString('en-IN')}`;
export default function BookingConfirmation({booking,vehicle,onTrips,onExplore}){
 const pricing=booking?.pricing||{};
 return <View style={styles.page}>
  <Text style={styles.icon}>✓</Text><Text style={styles.title}>Booking request received</Text>
  <Text style={styles.sub}>The RideOn server accepted your booking request. This does not indicate that a payment was processed.</Text>
  <View style={styles.card}><Text style={styles.kicker}>BOOKING REFERENCE</Text><Text style={styles.reference}>{booking?.bookingId||booking?.id||'—'}</Text>
   {vehicle?.name||booking?.vehicleName?<Text style={styles.rowText}>{vehicle?.name||booking?.vehicleName}</Text>:null}
   {booking?.status?<Line label="Status" value={booking.status}/>:null}{booking?.paymentStatus?<Line label="Payment status" value={booking.paymentStatus}/>:null}
   {(booking?.startAt||booking?.endAt)&&<Line label="Rental" value={[booking?.startAt,booking?.endAt].filter(Boolean).join(' → ')}/>}
   {booking?.address&&<Line label={booking?.delivery?'Delivery':'Location'} value={booking.address}/>}
   {pricing.total!=null&&<Line label="Amount" value={money(pricing.total)}/>}
   {booking?.totalPrice!=null&&pricing.total==null?<Line label="Amount" value={money(booking.totalPrice)}/>:null}
  </View>
  <View style={styles.actions}><TouchableOpacity style={styles.primary} onPress={onTrips}><Text style={styles.primaryText}>View Trips</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={onExplore}><Text style={styles.secondaryText}>Back to Explore</Text></TouchableOpacity></View>
 </View>;
}
function Line({label,value}){return <View style={styles.line}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{String(value)}</Text></View>;}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#F6F7F9',padding:24,justifyContent:'center'},icon:{width:74,height:74,borderRadius:37,backgroundColor:'#E6F6EE',textAlign:'center',textAlignVertical:'center',fontSize:40,color:C.green,overflow:'hidden',marginBottom:18,alignSelf:'center'},title:{fontSize:27,fontWeight:'900',color:C.ink,textAlign:'center'},sub:{fontSize:13,color:C.muted,lineHeight:19,textAlign:'center',marginTop:8,marginBottom:18},card:{backgroundColor:C.white,borderRadius:18,borderWidth:1,borderColor:C.line,padding:17},kicker:{fontSize:9,letterSpacing:1.2,fontWeight:'900',color:C.muted},reference:{fontSize:24,fontWeight:'900',color:C.ink,marginTop:5,marginBottom:10},rowText:{fontSize:14,fontWeight:'900',color:C.ink,marginBottom:8},line:{flexDirection:'row',justifyContent:'space-between',gap:15,paddingVertical:7,borderTopWidth:1,borderTopColor:'#F0F1F4'},label:{fontSize:11,color:C.muted,flex:1},value:{fontSize:11,fontWeight:'800',color:C.ink,flex:1,textAlign:'right'},actions:{marginTop:17,gap:9},primary:{backgroundColor:C.orange,paddingVertical:15,borderRadius:14,alignItems:'center'},primaryText:{color:'#fff',fontWeight:'900'},secondary:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,paddingVertical:15,borderRadius:14,alignItems:'center'},secondaryText:{color:C.ink,fontWeight:'900'}});
