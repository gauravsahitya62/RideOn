import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import RideOnApp from './src/screens/RideOnApp';
import VendorPortalReady from './src/screens/VendorPortalReady';

export default function App() {
  const [mode, setMode] = useState('customer');
  if (mode === 'vendor') {
    return <View style={styles.root}><VendorPortalReady onExit={() => setMode('customer')} /><TouchableOpacity style={styles.switch} onPress={() => setMode('customer')}><Text style={styles.switchText}>Customer app</Text></TouchableOpacity></View>;
  }
  return <View style={styles.root}><RideOnApp /><TouchableOpacity style={styles.switch} onPress={() => setMode('vendor')}><Text style={styles.switchText}>Vendor portal ↗</Text></TouchableOpacity></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  switch: { position: 'absolute', right: 14, top: 54, zIndex: 100, backgroundColor: '#172033', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9, elevation: 5 },
  switchText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' }
});
