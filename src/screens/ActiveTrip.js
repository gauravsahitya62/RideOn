import React, { useEffect, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Constants from 'expo-constants';
import * as Location from 'expo-location';

const INK = '#12161C';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const MUTED = '#6B7280';
const isExpoGo = Constants.appOwnership === 'expo';
const imageOf = vehicle => [...(Array.isArray(vehicle?.images) ? vehicle.images : []), vehicle?.imageUrl].find(value => typeof value === 'string' && /^https?:\/\//i.test(value));
const stamp = value => {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};
const durationLabel = milliseconds => {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const minutes = Math.floor(milliseconds / 60000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

export default function ActiveTrip({ booking, vehicle, error, busy, onBack, onHelp, onEnd, onDetails }) {
  const [now, setNow] = useState(Date.now());
  const [here, setHere] = useState(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(permission => {
      if (permission.status !== 'granted') return;
      return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    }).then(position => {
      if (position?.coords) setHere({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    }).catch(() => {});
  }, []);
  const startedAt = booking?.deliveredAt || booking?.pickupAt;
  const started = startedAt ? new Date(startedAt).getTime() : null;
  const ends = booking?.returnAt ? new Date(booking.returnAt).getTime() : null;
  const elapsed = started ? now - started : null;
  const remaining = ends ? ends - now : null;
  const delivered = Boolean(booking?.deliveredAt) || String(booking?.deliveryStatus || '').toLowerCase() === 'delivered' || ['ACTIVE_RENTAL', 'OVERDUE', 'RETURN_REQUESTED', 'PICKUP_STARTED', 'RETURNED', 'COMPLETED'].includes(String(booking?.lifecycleState || '').toUpperCase());
  const inProgress = ['in_progress'].includes(String(booking?.status || '').toLowerCase()) || ['ACTIVE_RENTAL', 'OVERDUE'].includes(String(booking?.lifecycleState || '').toUpperCase());
  const returning = ['RETURN_REQUESTED', 'PICKUP_STARTED', 'RETURNED', 'COMPLETED'].includes(String(booking?.lifecycleState || '').toUpperCase());
  const settled = ['settled', 'refunded', 'released'].includes(String(booking?.securityDepositStatus || '').toLowerCase());
  const dropoff = booking?.deliveryLatitude != null && booking?.deliveryLongitude != null ? { latitude: Number(booking.deliveryLatitude), longitude: Number(booking.deliveryLongitude) } : null;
  const points = [here, dropoff].filter(Boolean);
  const region = points.length ? { latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length, longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length, latitudeDelta: 0.08, longitudeDelta: 0.08 } : null;
  const image = imageOf(vehicle) || imageOf(booking);
  const specs = [vehicle?.fuel, vehicle?.transmission].filter(Boolean);
  const place = booking?.returnLocation || booking?.address || 'Drop-off on this booking';
  const navigate = () => {
    const target = dropoff ? `${dropoff.latitude},${dropoff.longitude}` : place;
    if (!target || target === 'Drop-off on this booking') return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target)}`).catch(() => {});
  };
  const steps = [
    ['Vehicle Delivered', delivered, delivered ? (booking?.deliveredAt ? `Delivered ${stamp(booking.deliveredAt)}` : 'Delivered') : 'Waiting for delivery'],
    ['Trip in Progress', inProgress || returning, inProgress ? `Started at ${stamp(startedAt)}` : ''],
    ['Return Vehicle', returning, 'Request a return when you are finished.'],
    ['Deposit Settlement', settled, Number(booking?.pricing?.securityDeposit) > 0 ? 'The deposit is refundable after the vehicle is returned.' : 'No security deposit on this booking.'],
  ];

  return <View style={styles.root}>
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backText}>←</Text></TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Trip in Progress</Text>
        <Text style={styles.sub}>Your rental details from this booking.</Text>
      </View>
      <TouchableOpacity onPress={onHelp} accessibilityRole="button"><Text style={styles.help}>Help</Text></TouchableOpacity>
    </View>
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <View style={styles.vehicle}>
          <View style={styles.photo}>{image ? <Image source={{ uri: image }} style={styles.photoImage} /> : <Text style={styles.emoji}>🛵</Text>}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.vehicleName}>{vehicle?.name || booking?.vehicle || 'RideOn vehicle'}</Text>
            <View style={styles.specs}>{specs.map(spec => <Text key={spec} style={styles.spec}>{spec}</Text>)}</View>
          </View>
        </View>
      </View>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.section}>Trip Timeline</Text>
          <Text style={styles.badge}>{inProgress ? 'In Progress' : booking?.displayStatus || 'Saved'}</Text>
        </View>
        {steps.map(([label, done, hint], index) => <View key={label} style={styles.timeline}>
          <View style={styles.rail}>{index > 0 && <View style={[styles.railLine, done && styles.railOn]} />}<View style={[styles.dot, done && styles.dotOn]}>{done ? <Text style={styles.dotCheck}>✓</Text> : null}</View></View>
          <View style={{ flex: 1 }}><Text style={[styles.stepTitle, done && styles.stepOn]}>{label}</Text>{!!hint && <Text style={styles.stepHint}>{hint}</Text>}</View>
        </View>)}
        <View style={styles.duration}>
          <Text style={styles.etaLabel}>Trip duration</Text>
          <Text style={styles.durationValue}>{durationLabel(elapsed)}</Text>
          <Text style={styles.stepHint}>{remaining == null ? 'Return time is on the booking' : remaining < 0 ? 'Return time has passed' : `Remaining ${durationLabel(remaining)}`}</Text>
        </View>
      </View>
      <View style={styles.mapWrap}>
        {region ? <MapView provider={!isExpoGo ? PROVIDER_GOOGLE : undefined} style={StyleSheet.absoluteFill} initialRegion={region}>
          {here && <Marker coordinate={here} title="Your location" pinColor="#2F6BFF" />}
          {dropoff && <Marker coordinate={dropoff} title="Drop-off" description={place} />}
        </MapView> : <Text style={styles.mapEmpty}>The drop-off map appears when this booking has a saved location.</Text>}
      </View>
      <View style={styles.metrics}>
        <View style={styles.metric}><Text style={styles.metricLabel}>Current ride time</Text><Text style={styles.metricValue}>{durationLabel(elapsed)}</Text><Text style={styles.stepHint}>{started ? `Started at ${stamp(startedAt)}` : 'Starts when the vehicle is with you'}</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>Return by</Text><Text style={styles.metricValue}>{booking?.returnAt ? stamp(booking.returnAt) : '—'}</Text><Text style={styles.stepHint}>{place}</Text></View>
      </View>
    </ScrollView>
    {!!error && <Text style={styles.error}>{error}</Text>}
    <View style={styles.footer}>
      <TouchableOpacity style={[styles.end, busy && styles.endOff]} disabled={busy} onPress={onEnd} accessibilityRole="button"><Text style={styles.endText}>{busy ? 'Opening…' : returning ? 'Return inspection' : 'End Trip'}</Text></TouchableOpacity>
      <TouchableOpacity style={styles.nav} onPress={navigate} accessibilityRole="button"><Text style={styles.navText}>Navigate</Text></TouchableOpacity>
    </View>
    {!!onDetails && <TouchableOpacity onPress={onDetails} accessibilityRole="button" style={styles.details}><Text style={styles.help}>Booking details</Text></TouchableOpacity>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8FA' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, paddingBottom: 8 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 22, color: INK },
  title: { color: INK, fontSize: 20, fontWeight: '800' },
  sub: { color: MUTED, fontSize: 12, marginTop: 2 },
  help: { color: GREEN, fontWeight: '800' },
  page: { padding: 16, paddingTop: 8, paddingBottom: 16 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E8ECF0', padding: 14, marginBottom: 12 },
  vehicle: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  photo: { width: 92, height: 68, borderRadius: 12, backgroundColor: '#F3F5F7', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoImage: { width: '100%', height: '100%' },
  emoji: { fontSize: 28 },
  vehicleName: { color: INK, fontSize: 16, fontWeight: '800' },
  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  spec: { color: '#3C4652', fontSize: 11, fontWeight: '700', backgroundColor: '#F4F6F8', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  section: { color: INK, fontSize: 16, fontWeight: '800' },
  badge: { color: GREEN, fontSize: 12, fontWeight: '800', backgroundColor: '#E7F8EC', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  timeline: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  rail: { width: 22, alignItems: 'center' },
  railLine: { position: 'absolute', top: -10, width: 2, height: 16, backgroundColor: '#E5E7EB' },
  railOn: { backgroundColor: BUTTON },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D5DBE1', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: BUTTON, borderColor: BUTTON },
  dotCheck: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  stepTitle: { color: MUTED, fontSize: 14, fontWeight: '800' },
  stepOn: { color: GREEN },
  stepHint: { color: MUTED, fontSize: 11, marginTop: 2 },
  duration: { backgroundColor: '#F3FBF6', borderRadius: 14, padding: 12, marginTop: 4 },
  etaLabel: { color: MUTED, fontSize: 12 },
  durationValue: { color: GREEN, fontSize: 22, fontWeight: '800', marginTop: 2 },
  mapWrap: { height: 220, borderRadius: 18, overflow: 'hidden', backgroundColor: '#E7ECF2', marginBottom: 12, alignItems: 'center', justifyContent: 'center' },
  mapEmpty: { color: MUTED, textAlign: 'center', padding: 16 },
  metrics: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E8ECF0', padding: 12 },
  metricLabel: { color: MUTED, fontSize: 11 },
  metricValue: { color: INK, fontSize: 18, fontWeight: '800', marginTop: 4 },
  footer: { flexDirection: 'row', gap: 8, padding: 16, paddingTop: 8 },
  end: { flex: 1, height: 52, borderRadius: 26, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  endText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  nav: { height: 52, borderRadius: 26, borderWidth: 1, borderColor: '#E8ECF0', paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  navText: { color: INK, fontWeight: '800' },
  endOff: { backgroundColor: '#9CA3AF' },
  error: { color: '#B42318', fontSize: 13, paddingHorizontal: 16 },
  details: { alignItems: 'center', paddingBottom: 12 },
});
