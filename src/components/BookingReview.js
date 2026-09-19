import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import CheckoutSummary from './CheckoutSummary';
import PaymentMethodSelector from './PaymentMethodSelector';
export default function BookingReview({vehicle,date,pickupTime,returnDate,returnTime,duration,city,delivery,address,quote,paymentMethod,onPaymentMethodChange}){
 return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
  <Text style={styles.title}>Review your booking</Text>
  <Text style={styles.sub}>Confirm the rental details before sending the booking request.</Text>
  <CheckoutSummary vehicle={vehicle} date={date} pickupTime={pickupTime} returnDate={returnDate} returnTime={returnTime} duration={duration} city={city} delivery={delivery} address={address} quote={quote} fallbackSubtotal={(vehicle?.price||0)*duration}/>
  <PaymentMethodSelector value={paymentMethod} onChange={onPaymentMethodChange}/>
 </ScrollView>;
}
const styles=StyleSheet.create({page:{padding:20,paddingBottom:30},title:{fontSize:29,fontWeight:'900',color:'#17202D',letterSpacing:-.8},sub:{fontSize:13,color:'#78818E',lineHeight:19,marginTop:6,marginBottom:18}});
