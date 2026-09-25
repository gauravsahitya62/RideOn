import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { authService } from './authService';
import AuthScreen from './AuthScreen';
import RideOnApp from '../screens/RideOnApp';
import VendorPortalReady from '../screens/VendorPortalReady';
import FleetOperationsScreen from '../screens/FleetOperationsScreen';

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
  if (!user || !['customer','vendor','support','admin','delivery_staff'].includes(user.role)) return <AuthScreen onAuthenticated={handleAuthenticated} />;
  if (user.role === 'vendor') return <VendorPortalReady user={user} onLogout={signOut} />;
  if (['support','admin','delivery_staff'].includes(user.role)) return <FleetOperationsScreen user={user} onBack={signOut} />;
  return <RideOnApp authenticatedUser={user} onLogout={signOut} />;
}

function LoadingScreen() {
  return <SafeAreaView style={s.safe}><View style={s.loading}><Text style={s.brand}>ride<Text style={{color:'#E85D35'}}>.on</Text></Text><ActivityIndicator size="small"/><Text style={s.text}>Restoring your secure session…</Text></View></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:'#F6F7F9'},loading:{flex:1,alignItems:'center',justifyContent:'center',gap:14},brand:{fontSize:36,fontWeight:'900',letterSpacing:-2,color:'#17202D'},text:{fontSize:12,color:'#78818E'}});
