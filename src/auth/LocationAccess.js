import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';

const GREEN = '#067A4A';
const BUTTON = '#07A574';
const INK = '#12161C';

export default function LocationAccess({ onBack, onDone }) {
  const [busy, setBusy] = useState(false);

  const allow = async () => {
    if (busy) return;
    setBusy(true);
    try { await Location.requestForegroundPermissionsAsync(); } catch {}
    setBusy(false);
    onDone();
  };

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <View style={styles.page}>
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={styles.back}>
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>
      <View style={styles.hero}>
        <View style={styles.glow} />
        <View style={styles.map}>
          <View style={styles.road} />
        </View>
        <View style={styles.pin}><View style={styles.pinHole} /></View>
      </View>
      <Text style={styles.title}>Allow <Text style={styles.titleGreen}>Location</Text> Access</Text>
      <Text style={styles.sub}>We need your location to show nearby vehicles, accurate distances and a better ride experience.</Text>
      <View style={styles.card}>
        <Row icon={<PinMark />} title="Find Nearby Vehicles" body="See bikes and scooters near your location." />
        <Row icon={<RouteMark />} title="Get Accurate Distance & ETA" body="Know exactly how far and how long it will take." />
        <Row icon={<ShieldMark />} title="Better Safety & Experience" body="Helps us keep your rides secure and reliable." />
      </View>
      <TouchableOpacity style={styles.button} onPress={allow} disabled={busy} accessibilityRole="button">
        <Text style={styles.buttonText}>{busy ? 'Asking…' : 'Allow Location Access'}</Text>
        {!busy && <Text style={styles.arrow}>→</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={onDone} disabled={busy} accessibilityRole="button">
        <Text style={styles.skip}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  </SafeAreaView>;
}

function Row({ icon, title, body }) {
  return <View style={styles.row}>
    <View style={styles.icon}>{icon}</View>
    <View style={{ flex: 1 }}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.rowBody}>{body}</Text>
    </View>
  </View>;
}

function PinMark() {
  return <View style={styles.smallPin}><View style={styles.smallPinHole} /></View>;
}
function RouteMark() {
  return <View style={styles.route}><View style={styles.routeDot} /><View style={styles.routeLine} /><View style={styles.routeDot} /></View>;
}
function ShieldMark() {
  return <View style={styles.shield}><Text style={styles.shieldTick}>✓</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { flex: 1, paddingHorizontal: 22, paddingBottom: 12 },
  back: { marginTop: 8, width: 40, height: 40, justifyContent: 'center' },
  backArrow: { color: INK, fontSize: 24, fontWeight: '600' },
  hero: { height: 168, alignItems: 'center', justifyContent: 'flex-end', marginTop: 8, marginBottom: 16 },
  glow: { position: 'absolute', top: 0, width: 170, height: 150, borderTopLeftRadius: 90, borderTopRightRadius: 90, backgroundColor: '#E7F8EC' },
  map: { width: 132, height: 72, borderRadius: 16, backgroundColor: '#F4F7F8', borderWidth: 1, borderColor: '#E3E8EC', overflow: 'hidden', transform: [{ rotate: '-8deg' }], marginBottom: 6 },
  road: { position: 'absolute', left: -10, right: -10, top: 30, height: 10, backgroundColor: '#7EC8E3', borderRadius: 8, transform: [{ rotate: '-12deg' }] },
  pin: { position: 'absolute', top: 28, width: 46, height: 46, borderRadius: 23, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  pinHole: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF' },
  title: { textAlign: 'center', color: INK, fontSize: 28, lineHeight: 34, fontWeight: '800' },
  titleGreen: { color: GREEN, fontSize: 28, lineHeight: 34, fontWeight: '800' },
  sub: { textAlign: 'center', color: '#5E6872', fontSize: 15, lineHeight: 22, marginTop: 10, paddingHorizontal: 8 },
  card: { marginTop: 22, backgroundColor: '#F3FBF6', borderRadius: 18, padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E7F8EC', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: INK, fontSize: 15, fontWeight: '800' },
  rowBody: { color: '#66707A', fontSize: 13, lineHeight: 18, marginTop: 2 },
  button: { marginTop: 22, height: 54, borderRadius: 27, backgroundColor: BUTTON, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  arrow: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  skip: { textAlign: 'center', color: '#8B949E', fontSize: 14, fontWeight: '600', marginTop: 16 },
  smallPin: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.6, borderColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  smallPinHole: { width: 4, height: 4, borderRadius: 2, backgroundColor: GREEN },
  route: { width: 18, height: 16, alignItems: 'center', justifyContent: 'space-between' },
  routeDot: { width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: GREEN },
  routeLine: { width: 1.5, flex: 1, backgroundColor: GREEN },
  shield: { width: 16, height: 18, borderWidth: 1.6, borderColor: GREEN, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, alignItems: 'center', justifyContent: 'center' },
  shieldTick: { color: GREEN, fontSize: 10, fontWeight: '800' },
});
