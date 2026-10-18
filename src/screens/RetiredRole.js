import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function RetiredRole({ onLogout }) {
  return <SafeAreaView style={s.safe}>
    <View style={s.card}>
      <Text style={s.title}>This account type is closed</Text>
      <Text style={s.body}>RideOn now has customer accounts and an admin dashboard. Vendor and delivery-staff sign-in is no longer available.</Text>
      <TouchableOpacity style={s.button} onPress={onLogout}><Text style={s.buttonText}>Sign out</Text></TouchableOpacity>
    </View>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#F7F5F1',justifyContent:'center',padding:24},
  card:{backgroundColor:'#fff',borderRadius:28,padding:24},
  title:{fontSize:24,fontWeight:'800',color:'#111827'},
  body:{color:'#6B7280',lineHeight:22,marginTop:8},
  button:{marginTop:18,backgroundColor:'#E56A3D',borderRadius:14,padding:14,alignItems:'center'},
  buttonText:{color:'#fff',fontWeight:'800'},
});
