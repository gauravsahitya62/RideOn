import React from 'react';
import { Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const API_URL = (process.env.EXPO_PUBLIC_USE_LOCAL_API === 'true' && process.env.EXPO_PUBLIC_API_URL
  ? process.env.EXPO_PUBLIC_API_URL
  : 'https://rideon-api-262g.onrender.com').replace(/\/+$/, '');

export default function AdminEntry({ user, onLogout }) {
  const dashboard = API_URL + '/admin';
  return <SafeAreaView style={s.safe}>
    <View style={s.card}>
      <Text style={s.brand}>ride<Text style={s.accent}>on</Text></Text>
      <Text style={s.title}>Admin dashboard</Text>
      <Text style={s.body}>Inventory, bookings, payments, and customer verification are managed on the RideOn admin site.</Text>
      <Text style={s.url}>{dashboard}</Text>
      <TouchableOpacity style={s.button} onPress={() => Linking.openURL(dashboard)}>
        <Text style={s.buttonText}>Open admin dashboard</Text>
      </TouchableOpacity>
      <Text style={s.note}>Signed in as {user?.email || user?.name || 'admin'}. Sign in again on the website with this same email.</Text>
      <TouchableOpacity onPress={onLogout}><Text style={s.link}>Sign out</Text></TouchableOpacity>
    </View>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#F7F5F1',justifyContent:'center',padding:24},
  card:{backgroundColor:'#fff',borderRadius:28,padding:24},
  brand:{fontSize:28,fontWeight:'800',color:'#111827'},
  accent:{color:'#E56A3D'},
  title:{fontSize:24,fontWeight:'800',marginTop:16,color:'#111827'},
  body:{color:'#6B7280',lineHeight:22,marginTop:8},
  url:{marginTop:16,color:'#111827',fontWeight:'700'},
  button:{marginTop:18,backgroundColor:'#E56A3D',borderRadius:14,padding:14,alignItems:'center'},
  buttonText:{color:'#fff',fontWeight:'800'},
  note:{color:'#6B7280',marginTop:14,lineHeight:20},
  link:{color:'#E56A3D',fontWeight:'800',marginTop:18},
});
