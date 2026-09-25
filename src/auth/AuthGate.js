import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { authService } from './authService';
import AuthScreen from './AuthScreen';
import RideOnApp from '../screens/RideOnApp';
import VendorPortalReady from '../screens/VendorPortalReady';

function OperationsPortalPlaceholder({user,onLogout}) {
  return <SafeAreaView style={s.safe}><View style={s.loading}><Text style={s.brand}>ride<Text style={{color:'#E85D35'}}>.on</Text></Text><Text style={[s.text,{fontSize:16,fontWeight:'800',color:'#17202D'}]}>Operations access</Text><Text style={s.text}>Signed in as {user.role.replace('_',' ')}. Use the authenticated RideOn operations APIs; customer and vendor actions are not exposed from this account.</Text><TouchableOpacity onPress={onLogout} style={{marginTop:8,paddingHorizontal:18,paddingVertical:12,borderRadius:10,borderWidth:1,borderColor:'#E8EAF0'}}><Text style={{fontWeight:'800',color:'#17202D'}}>Sign out</Text></TouchableOpacity></View></SafeAreaView>;
}


export default function AuthGate() {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);

  useEffect(() => {
    let active = true;
    authService.restoreSession().then((result) => {
      if (!active) return;
      if (!result) { setUser(null); setStatus('unauthenticated'); return; }
      setUser({...result.user, token: result.token});
      setStatus('authenticated');
    }).catch(() => {
      if (!active) return;
      setUser(null);
      setStatus('unauthenticated');
    });
    return () => { active = false; };
  }, []);

  const handleAuthenticated = (nextUser) => { setUser(nextUser); setStatus('authenticated'); };
  const signOut = async () => { await authService.signOut(); setUser(null); setStatus('unauthenticated'); };

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'unauthenticated') return <AuthScreen onAuthenticated={handleAuthenticated} />;
  if (!user || !['customer', 'vendor', 'support', 'admin', 'delivery_staff'].includes(user.role)) return <AuthScreen onAuthenticated={handleAuthenticated} />;
  if (user.role === 'vendor') return <VendorPortalReady user={user} onLogout={signOut} />;
  if (['support', 'admin', 'delivery_staff'].includes(user.role)) return <OperationsPortalPlaceholder user={user} onLogout={signOut} />;
  return <RideOnApp authenticatedUser={user} onLogout={signOut} />;
}

function LoadingScreen() {
  return <SafeAreaView style={s.safe}><View style={s.loading}><Text style={s.brand}>ride<Text style={{color:'#E85D35'}}>.on</Text></Text><ActivityIndicator size="small"/><Text style={s.text}>Restoring your secure session…</Text></View></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:'#F6F7F9'},loading:{flex:1,alignItems:'center',justifyContent:'center',gap:14},brand:{fontSize:36,fontWeight:'900',letterSpacing:-2,color:'#17202D'},text:{fontSize:12,color:'#78818E'}});
