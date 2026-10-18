import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const GREEN = '#067A4A';
const BUTTON = '#07A574';
const INK = '#12161C';

export default function AccountCreated({ onContinue }) {
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <View style={styles.page}>
      <View style={styles.hero}>
        <View style={styles.glow} />
        <View style={styles.badge}><Text style={styles.badgeTick}>✓</Text></View>
        <ScooterArt />
      </View>
      <Text style={styles.title}>Account <Text style={styles.titleGreen}>Created!</Text></Text>
      <Text style={styles.welcome}>Welcome to RideOn</Text>
      <Text style={styles.sub}>You can now explore and book bikes and scooters for your next ride.</Text>
      <View style={styles.card}>
        <Row icon={<ScooterMark />} title="Wide Range of Vehicles" body="Find the perfect bike or scooter near you." />
        <Row icon={<CalendarMark />} title="Easy Booking" body="Quick and secure booking process." />
        <Row icon={<PinMark />} title="Explore More" body="Ride to your favorite places with ease." />
      </View>
      <TouchableOpacity style={styles.button} onPress={onContinue} accessibilityRole="button">
        <Text style={styles.buttonText}>Continue to Home</Text>
        <Text style={styles.arrow}>→</Text>
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

function ScooterArt() {
  return <View style={styles.scooterArt}>
    <View style={styles.scooterBody} />
    <View style={styles.scooterSeat} />
    <View style={styles.scooterFront} />
    <View style={[styles.scooterWheel, { left: 8 }]} />
    <View style={[styles.scooterWheel, { right: 10 }]} />
  </View>;
}
function ScooterMark() {
  return <View style={styles.mini}><View style={styles.miniBody} /><View style={[styles.miniWheel, { left: 0 }]} /><View style={[styles.miniWheel, { right: 0 }]} /></View>;
}
function CalendarMark() {
  return <View style={styles.calendar}><View style={styles.calendarTop} /></View>;
}
function PinMark() {
  return <View style={styles.pin}><View style={styles.pinDot} /></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F8FA' },
  page: { flex: 1, paddingHorizontal: 22, paddingTop: 36, paddingBottom: 18, justifyContent: 'center' },
  hero: { height: 168, alignItems: 'center', justifyContent: 'flex-end', marginBottom: 18 },
  glow: { position: 'absolute', top: 0, width: 168, height: 168, borderRadius: 84, backgroundColor: '#E7F8EC' },
  badge: { position: 'absolute', top: 18, width: 64, height: 64, borderRadius: 32, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  badgeTick: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', marginTop: -2 },
  scooterArt: { width: 132, height: 58, marginBottom: 8 },
  scooterBody: { position: 'absolute', left: 18, top: 16, width: 78, height: 22, borderRadius: 12, backgroundColor: '#F4F7F5', borderWidth: 2, borderColor: GREEN },
  scooterSeat: { position: 'absolute', left: 34, top: 8, width: 36, height: 12, borderRadius: 6, backgroundColor: '#1F2933' },
  scooterFront: { position: 'absolute', right: 16, top: 10, width: 22, height: 18, borderTopRightRadius: 10, borderBottomRightRadius: 6, backgroundColor: BUTTON },
  scooterWheel: { position: 'absolute', bottom: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: '#1F2933', borderWidth: 4, borderColor: '#D7DDE3' },
  title: { textAlign: 'center', color: INK, fontSize: 30, lineHeight: 36, fontWeight: '800' },
  titleGreen: { color: GREEN, fontSize: 30, lineHeight: 36, fontWeight: '800' },
  welcome: { textAlign: 'center', color: '#66707A', fontSize: 18, marginTop: 8 },
  sub: { textAlign: 'center', color: '#7B848E', fontSize: 15, lineHeight: 22, marginTop: 8, paddingHorizontal: 12 },
  card: { marginTop: 22, backgroundColor: '#F3FBF6', borderRadius: 18, padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E7F8EC', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: INK, fontSize: 15, fontWeight: '800' },
  rowBody: { color: '#66707A', fontSize: 13, lineHeight: 18, marginTop: 2 },
  button: { marginTop: 22, height: 54, borderRadius: 27, backgroundColor: BUTTON, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  arrow: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  mini: { width: 20, height: 14 },
  miniBody: { position: 'absolute', left: 2, top: 2, width: 14, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: GREEN },
  miniWheel: { position: 'absolute', bottom: 0, width: 6, height: 6, borderRadius: 3, borderWidth: 1.4, borderColor: GREEN },
  calendar: { width: 16, height: 16, borderRadius: 3, borderWidth: 1.5, borderColor: GREEN, overflow: 'hidden' },
  calendarTop: { height: 5, backgroundColor: GREEN },
  pin: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.6, borderColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  pinDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: GREEN },
});
