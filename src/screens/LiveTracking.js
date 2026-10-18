import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import Constants from 'expo-constants';
import { rideOnApi } from '../services/api';

const INK = '#12161C';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const MUTED = '#6B7280';
const isExpoGo = Constants.appOwnership === 'expo';

function decodePolyline(encoded) {
  if (!encoded) return [];
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, bite;
    do { bite = encoded.charCodeAt(index++) - 63; result |= (bite & 31) << shift; shift += 5; } while (bite >= 32);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { bite = encoded.charCodeAt(index++) - 63; result |= (bite & 31) << shift; shift += 5; } while (bite >= 32);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}
const stamp = value => {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};
const imageOf = vehicle => [...(Array.isArray(vehicle?.images) ? vehicle.images : []), vehicle?.imageUrl].find(value => typeof value === 'string' && /^https?:\/\//i.test(value));

export default function LiveTracking({ booking, vehicle, onBack, onHelp, onDetails }) {
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const paid = ['paid', 'held', 'settlement_pending', 'settled'].includes(String(booking?.paymentStatus || '').toLowerCase());
  const confirmed = ['confirmed', 'in_progress', 'completed'].includes(String(booking?.status || '').toLowerCase());
  const delivering = String(booking?.deliveryStatus || tracking?.booking?.deliveryStatus || '').toLowerCase() === 'in_delivery' || ['DELIVERY_STARTED', 'IN_DELIVERY'].includes(String(booking?.lifecycleState || '').toUpperCase());
  const delivered = String(booking?.deliveryStatus || '').toLowerCase() === 'delivered' || Boolean(booking?.deliveredAt);
  const load = useCallback(async () => {
    if (!booking?.id) return;
    try {
      const result = await rideOnApi.getTracking(booking.id);
      setTracking(result?.tracking || null);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'Live tracking is not available for this booking yet.');
    } finally { setLoading(false); }
  }, [booking?.id]);
  useEffect(() => { load(); const timer = setInterval(load, 8000); return () => clearInterval(timer); }, [load]);
  const socketBookingId = booking?.id;
  const sessionStatus = tracking?.session?.status;
  useEffect(() => {
    if (!socketBookingId || sessionStatus !== 'active') return undefined;
    let socket;
    try {
      socket = rideOnApi.createTrackingSocket(socketBookingId, {
        onMessage: event => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'tracking.snapshot' || message.type === 'tracking.update' || message.type === 'tracking.completed' || message.type === 'tracking.stopped') {
              setTracking(current => ({ ...current, session: message.tracking?.session || current?.session, booking: message.tracking?.booking || current?.booking, location: message.tracking?.location || current?.location, route: message.tracking?.route || current?.route }));
            }
          } catch { /* ignore a malformed tracking frame */ }
        },
      });
    } catch { /* polling still refreshes the location */ }
    return () => { try { socket?.close(); } catch { /* already closed */ } };
  }, [socketBookingId, sessionStatus]);
  const current = tracking?.location || (tracking?.session?.lastLatitude != null ? { latitude: Number(tracking.session.lastLatitude), longitude: Number(tracking.session.lastLongitude) } : null);
  const destinationLatitude = booking?.deliveryLatitude ?? tracking?.booking?.deliveryLatitude;
  const destinationLongitude = booking?.deliveryLongitude ?? tracking?.booking?.deliveryLongitude;
  const destination = destinationLatitude != null && destinationLongitude != null ? { latitude: Number(destinationLatitude), longitude: Number(destinationLongitude) } : null;
  const route = useMemo(() => decodePolyline(tracking?.session?.lastRoutePolyline || tracking?.route?.encodedPolyline), [tracking]);
  const points = [current, destination, ...route].filter(point => point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  const region = useMemo(() => {
    if (!points.length) return null;
    const lats = points.map(point => point.latitude);
    const lons = points.map(point => point.longitude);
    return { latitude: (Math.min(...lats) + Math.max(...lats)) / 2, longitude: (Math.min(...lons) + Math.max(...lons)) / 2, latitudeDelta: Math.max(0.04, (Math.max(...lats) - Math.min(...lats)) * 1.6), longitudeDelta: Math.max(0.04, (Math.max(...lons) - Math.min(...lons)) * 1.6) };
  }, [points]);
  const duration = tracking?.route?.durationSeconds ?? tracking?.session?.lastRouteDurationSeconds;
  const distanceMeters = tracking?.route?.distanceMeters ?? tracking?.session?.lastRouteDistanceMeters;
  const etaMinutes = duration != null ? Math.max(1, Math.round(Number(duration) / 60)) : null;
  const remainingKm = distanceMeters != null ? `${(Number(distanceMeters) / 1000).toFixed(1)} km` : '';
  const arrival = etaMinutes != null ? new Date(Date.now() + etaMinutes * 60000).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';
  const image = imageOf(vehicle) || imageOf(booking);
  const specs = [vehicle?.fuel, vehicle?.transmission].filter(Boolean);
  const steps = [
    ['Booking Confirmed', confirmed, stamp(booking?.createdAt)],
    ['Payment Successful', paid, paid ? 'Verified' : ''],
    ['Out for Delivery', delivering || delivered, delivering ? 'Your vehicle is on the way' : ''],
    ['Ready for Pickup', delivered, delivered ? 'Delivered' : ''],
  ];
  const openMaps = () => {
    const target = destination ? `${destination.latitude},${destination.longitude}` : booking?.address;
    if (!target) return;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`).catch(() => {});
  };

  return <View style={styles.root}>
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backText}>←</Text></TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Live Tracking</Text>
        <Text style={styles.sub}>{delivering ? 'Your vehicle is on the way to the pickup location' : 'Tracking starts when the vehicle leaves for you'}</Text>
      </View>
      <TouchableOpacity onPress={onHelp} accessibilityRole="button"><Text style={styles.help}>Help</Text></TouchableOpacity>
    </View>
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <View style={styles.steps}>
          {steps.map(([label, done, hint], index) => <View key={label} style={styles.step}>
            {index > 0 && <View style={[styles.line, done && styles.lineOn]} />}
            <View style={[styles.dot, done && styles.dotOn]}>{done ? <Text style={styles.dotCheck}>✓</Text> : null}</View>
            <Text style={[styles.stepLabel, done && styles.stepLabelOn]}>{label}</Text>
            {!!hint && <Text style={styles.stepHint}>{hint}</Text>}
          </View>)}
        </View>
      </View>
      <View style={styles.mapWrap}>
        {loading && !region ? <ActivityIndicator color={BUTTON} /> : region ? <MapView provider={!isExpoGo ? PROVIDER_GOOGLE : undefined} style={StyleSheet.absoluteFill} initialRegion={region}>
          {route.length > 1 && <Polyline coordinates={route} strokeColor={BUTTON} strokeWidth={4} />}
          {destination && <Marker coordinate={destination} title="Pickup location" description={booking?.address || ''} />}
          {current && <Marker coordinate={current} title="Vehicle" />}
        </MapView> : <Text style={styles.mapEmpty}>{error || 'The map appears when RideOn has a delivery location for this booking.'}</Text>}
        {delivering && <View style={styles.bubble}><Text style={styles.bubbleTitle}>{current ? 'Driver is on the way' : 'Waiting for a location'}</Text><Text style={styles.bubbleSub}>{etaMinutes != null ? `${etaMinutes} min away${remainingKm ? ` · ${remainingKm}` : ''}` : 'Location updates as the vehicle moves'}</Text></View>}
      </View>
      <View style={styles.card}>
        <Text style={styles.partner}>RideOn delivery</Text>
        <Text style={styles.partnerSub}>{delivering ? 'A delivery partner is bringing the vehicle to your pickup location.' : 'A delivery partner appears here when the vehicle is on the way.'}</Text>
        <View style={styles.partnerActions}>
          <TouchableOpacity onPress={onHelp} accessibilityRole="button"><Text style={styles.help}>Message support</Text></TouchableOpacity>
          {!!onDetails && <TouchableOpacity onPress={onDetails} accessibilityRole="button"><Text style={styles.help}>Booking details</Text></TouchableOpacity>}
        </View>
      </View>
      <View style={styles.card}>
        <View style={styles.vehicle}>
          <View style={styles.photo}>{image ? <Image source={{ uri: image }} style={styles.photoImage} /> : <Text style={styles.emoji}>🛵</Text>}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.vehicleName}>{vehicle?.name || booking?.vehicle || 'RideOn vehicle'}</Text>
            <View style={styles.specs}>{specs.map(spec => <Text key={spec} style={styles.spec}>{spec}</Text>)}</View>
          </View>
        </View>
      </View>
      <View style={styles.eta}>
        <View style={{ flex: 1 }}>
          <Text style={styles.etaLabel}>Estimated arrival at pickup location</Text>
          <Text style={styles.etaValue}>{etaMinutes != null ? `${etaMinutes} minutes (${arrival})` : 'Waiting for a location update'}</Text>
        </View>
        <TouchableOpacity style={styles.maps} onPress={openMaps} accessibilityRole="button"><Text style={styles.mapsText}>View on Maps</Text></TouchableOpacity>
      </View>
    </ScrollView>
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
  page: { padding: 16, paddingTop: 8, paddingBottom: 24 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E8ECF0', padding: 14, marginBottom: 12 },
  steps: { flexDirection: 'row' },
  step: { flex: 1, alignItems: 'center' },
  line: { position: 'absolute', left: -14, right: 14, top: 9, height: 2, backgroundColor: '#E5E7EB' },
  lineOn: { backgroundColor: BUTTON },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D5DBE1', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: BUTTON, borderColor: BUTTON },
  dotCheck: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  stepLabel: { color: MUTED, fontSize: 9, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  stepLabelOn: { color: GREEN },
  stepHint: { color: MUTED, fontSize: 8, textAlign: 'center', marginTop: 2 },
  mapWrap: { height: 280, borderRadius: 18, overflow: 'hidden', backgroundColor: '#E7ECF2', marginBottom: 12, alignItems: 'center', justifyContent: 'center' },
  mapEmpty: { color: MUTED, fontSize: 13, textAlign: 'center', padding: 20 },
  bubble: { position: 'absolute', top: 12, right: 12, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 8 },
  bubbleTitle: { color: INK, fontSize: 12, fontWeight: '800' },
  bubbleSub: { color: MUTED, fontSize: 11, marginTop: 2 },
  partner: { color: INK, fontSize: 16, fontWeight: '800' },
  partnerSub: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 4, marginBottom: 8 },
  partnerActions: { flexDirection: 'row', gap: 16 },
  vehicle: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  photo: { width: 84, height: 64, borderRadius: 12, backgroundColor: '#F3F5F7', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoImage: { width: '100%', height: '100%' },
  emoji: { fontSize: 28 },
  vehicleName: { color: INK, fontSize: 16, fontWeight: '800' },
  specs: { flexDirection: 'row', gap: 6, marginTop: 6 },
  spec: { color: '#3C4652', fontSize: 11, fontWeight: '700', backgroundColor: '#F4F6F8', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  eta: { backgroundColor: '#F3FBF6', borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  etaLabel: { color: MUTED, fontSize: 12 },
  etaValue: { color: GREEN, fontSize: 16, fontWeight: '800', marginTop: 4 },
  maps: { borderWidth: 1, borderColor: '#8ED9B4', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  mapsText: { color: GREEN, fontWeight: '800', fontSize: 12 },
});
