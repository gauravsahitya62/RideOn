import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Modal, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Constants from 'expo-constants';
import { rideOnApi } from '../services/api';

const INK = '#12161C';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const MUTED = '#6B7280';
const SLOTS = [['front', 'Front View'], ['left', 'Left Side'], ['right', 'Right Side'], ['rear', 'Rear View'], ['odometer', 'Odometer']];
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const isExpoGo = Constants.appOwnership === 'expo';
const imageOf = vehicle => [...(Array.isArray(vehicle?.images) ? vehicle.images : []), vehicle?.imageUrl].find(value => typeof value === 'string' && /^https?:\/\//i.test(value));
const parsed = value => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};
const dayOf = value => parsed(value)?.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) || '';
const timeOf = value => parsed(value)?.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) || '';
const stampOf = value => parsed(value)?.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) || '';
const durationOf = (start, end) => {
  const from = parsed(start);
  const to = parsed(end);
  if (!from || !to || to <= from) return '';
  const minutes = Math.round((to - from) / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
};

export default function TripCompleted({ booking, vehicle, onBack, onHelp, onHome, onTrips, onProfile, onRate, onBook }) {
  const [photos, setPhotos] = useState([]);
  const [bill, setBill] = useState(false);
  const pricing = booking?.pricing || {};
  const paid = ['paid', 'held', 'settlement_pending', 'settled'].includes(String(booking?.paymentStatus || '').toLowerCase());
  const deposit = Number(pricing.securityDeposit || 0);
  const deduction = Number(booking?.securityDepositDeduction || 0);
  const recordedRefund = Number(booking?.securityDepositRefundable || 0);
  const depositStatus = String(booking?.securityDepositStatus || '').toLowerCase();
  const refunded = ['refunded', 'settled', 'released'].includes(depositStatus);
  const refundAmount = refunded ? (recordedRefund || Math.max(0, deposit - deduction)) : Math.max(0, deposit - deduction);
  const confirmed = ['confirmed', 'in_progress', 'completed'].includes(String(booking?.status || '').toLowerCase());
  const delivered = Boolean(booking?.deliveredAt) || ['DELIVERED', 'ACTIVE_RENTAL', 'RETURN_REQUESTED', 'PICKUP_STARTED', 'RETURNED', 'COMPLETED'].includes(String(booking?.lifecycleState || '').toUpperCase());
  const completed = String(booking?.status || '').toLowerCase() === 'completed' || String(booking?.lifecycleState || '').toUpperCase() === 'COMPLETED';
  const place = booking?.returnLocation || booking?.address || '';
  const image = imageOf(vehicle) || imageOf(booking);
  const helmets = Number(String(booking?.raw?.notes || booking?.notes || '').match(/(\d+)\s+extra helmet/i)?.[1] || 0);
  const specs = [vehicle?.fuel, vehicle?.transmission, vehicle?.registrationNumber, helmets > 0 ? `${helmets} extra helmet${helmets === 1 ? '' : 's'}` : ''].filter(Boolean);
  const startedAt = booking?.deliveredAt || booking?.pickupAt;
  const endedAt = booking?.returnRequestedAt || booking?.returnAt;
  const duration = durationOf(startedAt, endedAt);
  const distance = Number(booking?.routeDistanceMeters || 0);
  const point = booking?.deliveryLatitude != null && booking?.deliveryLongitude != null ? { latitude: Number(booking.deliveryLatitude), longitude: Number(booking.deliveryLongitude) } : null;
  const load = useCallback(async () => {
    if (!booking?.id) return;
    try {
      const result = await rideOnApi.getConditionEvidence(booking.id);
      const mine = (result?.evidence || []).filter(item => item.phase === 'pickup' && item.mediaType === 'image');
      setPhotos(mine);
    } catch { setPhotos([]); }
  }, [booking?.id]);
  useEffect(() => { load(); }, [load]);
  const bySlot = Object.fromEntries(photos.filter(item => item?.metadata?.slot).map(item => [item.metadata.slot, item]));
  const shown = SLOTS.map(([slot, label]) => bySlot[slot] ? { ...bySlot[slot], label } : null).filter(Boolean);
  const extras = photos.filter(item => !SLOTS.some(([slot]) => slot === item?.metadata?.slot) && item?.metadata?.slot !== 'damage');
  const inspectionAt = photos[0]?.capturedAt || booking?.securityDepositInspectedAt;
  const steps = [
    ['Booking Confirmed', confirmed, stampOf(booking?.createdAt)],
    ['Vehicle Delivered', delivered, stampOf(booking?.deliveredAt)],
    ['Trip Completed', completed, completed ? 'Completed' : ''],
    ['Return Inspection', shown.length > 0, stampOf(inspectionAt)],
    ['Deposit Refunded', deposit <= 0 || refunded, deposit <= 0 ? 'No deposit' : refunded ? 'Refunded' : 'Pending'],
  ];
  const lines = [
    ['Rental', pricing.rental],
    ['Delivery', pricing.deliveryFee],
    ['Platform fee', pricing.platformFee],
    ['Security deposit', pricing.securityDeposit],
  ].filter(([, amount]) => Number(amount) > 0);
  const billText = [`RideOn booking ${booking?.id || ''}`, vehicle?.name || booking?.vehicle || 'Vehicle', place, ...lines.map(([label, amount]) => `${label}: ${money(amount)}`), `Total: ${money(pricing.total)}`, `Payment: ${booking?.paymentStatus || 'unknown'}`].filter(Boolean).join('\n');
  const openMap = () => {
    const target = point ? `${point.latitude},${point.longitude}` : place;
    if (!target) return;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`).catch(() => {});
  };
  const shareTrip = () => Share.share({ message: `RideOn trip ${booking?.id || ''}\n${vehicle?.name || booking?.vehicle || 'Vehicle'}\n${place}${duration ? `\n${duration}` : ''}${paid ? `\n${money(pricing.total)}` : ''}`.trim() }).catch(() => {});
  const shareBill = () => Share.share({ message: billText }).catch(() => {});

  return <View style={styles.root}>
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backText}>←</Text></TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Trip Completed</Text>
        <Text style={styles.sub}>Thanks for riding with RideOn.</Text>
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
        <View style={styles.steps}>
          {steps.map(([label, done, hint], index) => <View key={label} style={styles.step}>
            {index > 0 && <View style={[styles.line, done && styles.lineOn]} />}
            <View style={[styles.dot, done && styles.dotOn]}>{done ? <Text style={styles.check}>✓</Text> : null}</View>
            <Text style={[styles.stepLabel, done && styles.stepOn]}>{label}</Text>
            {!!hint && <Text style={styles.stepHint}>{hint}</Text>}
          </View>)}
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>Trip Details</Text>
        <View style={styles.detailRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Pickup</Text>
            <Text style={styles.place}>{dayOf(booking?.pickupAt) || 'On the booking'}</Text>
            {!!timeOf(booking?.pickupAt) && <Text style={styles.time}>{timeOf(booking.pickupAt)}</Text>}
            <Text style={[styles.kicker, { marginTop: 10 }]}>Drop-off</Text>
            <Text style={styles.place}>{dayOf(booking?.returnAt) || 'On the booking'}</Text>
            {!!timeOf(booking?.returnAt) && <Text style={styles.time}>{timeOf(booking.returnAt)}</Text>}
            <Text style={[styles.kicker, { marginTop: 10 }]}>Location</Text>
            <Text style={styles.place}>{place || 'On the booking'}</Text>
            <TouchableOpacity onPress={openMap} accessibilityRole="button"><Text style={styles.link}>View on Map</Text></TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>
            {!!duration && <><Text style={styles.kicker}>Rental time</Text><Text style={styles.metric}>{duration}</Text></>}
            {distance > 0 && <><Text style={[styles.kicker, { marginTop: 10 }]}>Route distance</Text><Text style={styles.metric}>{(distance / 1000).toFixed(1)} km</Text></>}
            <Text style={[styles.kicker, { marginTop: 10 }]}>{paid ? 'Amount paid' : 'Booking total'}</Text>
            <Text style={styles.metric}>{pricing.total != null ? money(pricing.total) : '—'}</Text>
            <TouchableOpacity onPress={() => setBill(true)} accessibilityRole="button"><Text style={styles.link}>View Bill</Text></TouchableOpacity>
          </View>
          {point && <MapView provider={!isExpoGo ? PROVIDER_GOOGLE : undefined} style={styles.map} initialRegion={{ ...point, latitudeDelta: 0.08, longitudeDelta: 0.08 }} scrollEnabled={false}><Marker coordinate={point} title="Drop-off" /></MapView>}
        </View>
      </View>
      <View style={styles.card}>
        <View style={styles.row}><Text style={styles.section}>Return Inspection</Text>{shown.length > 0 && <Text style={styles.badge}>Recorded</Text>}</View>
        {shown.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>{[...shown, ...extras.map(item => ({ ...item, label: 'Photo' }))].map(item => <View key={item.id} style={styles.tile}><Image source={{ uri: item.url }} style={styles.tileImage} /><Text style={styles.tileLabel}>{item.label}</Text></View>)}</ScrollView> : <Text style={styles.hint}>Return photos appear here after the inspection is saved.</Text>}
      </View>
      <View style={styles.card}>
        <View style={styles.row}><Text style={styles.section}>Security Deposit</Text>{deposit <= 0 ? null : <Text style={styles.badge}>{refunded ? 'Refunded' : 'Held'}</Text>}</View>
        {deposit > 0 ? <>
          <View style={styles.refundRow}>
            <View><Text style={styles.kicker}>Security deposit</Text><Text style={styles.metric}>{money(deposit)}</Text></View>
            <Text style={styles.minus}>−</Text>
            <View><Text style={styles.kicker}>Deductions</Text><Text style={styles.metric}>{money(deduction)}</Text></View>
            <Text style={styles.minus}>=</Text>
            <View style={styles.refundBox}><Text style={styles.kicker}>{refunded ? 'Refund amount' : 'Held for refund'}</Text><Text style={styles.refundValue}>{money(refundAmount)}</Text></View>
          </View>
          <Text style={styles.hint}>{refunded ? 'The refund has been sent to your original payment method.' : 'The deposit stays with RideOn until the return inspection is settled.'}{refunded && stampOf(booking?.securityDepositInspectedAt) ? ` ${stampOf(booking.securityDepositInspectedAt)}` : ''}</Text>
        </> : <Text style={styles.hint}>This booking has no security deposit.</Text>}
      </View>
      <TouchableOpacity style={styles.review} onPress={onRate} accessibilityRole="button">
        <View style={{ flex: 1 }}><Text style={styles.section}>How was your experience?</Text><Text style={styles.hint}>Share feedback for this rental.</Text></View>
        <Text style={styles.link}>Rate</Text>
      </TouchableOpacity>
    </ScrollView>
    <View style={styles.actions}>
      <TouchableOpacity style={styles.ghost} onPress={shareBill} accessibilityRole="button"><Text style={styles.ghostText}>Invoice</Text></TouchableOpacity>
      <TouchableOpacity style={styles.ghost} onPress={shareTrip} accessibilityRole="button"><Text style={styles.ghostText}>Share Trip</Text></TouchableOpacity>
      <TouchableOpacity style={styles.again} onPress={onBook} accessibilityRole="button"><Text style={styles.againText}>Book Again</Text></TouchableOpacity>
    </View>
    <View style={styles.tabs}>
      {[['Home', onHome], ['My Bookings', onTrips], ['Help', onHelp], ['Profile', onProfile]].map(([label, action]) => <TouchableOpacity key={label} onPress={action} accessibilityRole="tab" style={styles.tab}><Text style={[styles.tabText, label === 'My Bookings' && styles.tabOn]}>{label}</Text></TouchableOpacity>)}
    </View>
    <Modal visible={bill} transparent animationType="fade" onRequestClose={() => setBill(false)}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setBill(false)}>
        <View style={styles.sheet}>
          <Text style={styles.section}>Bill</Text>
          <Text style={styles.hint}>Booking {booking?.id}</Text>
          {lines.map(([label, amount]) => <View key={label} style={styles.lineItem}><Text style={styles.hint}>{label}</Text><Text style={styles.lineValue}>{money(amount)}</Text></View>)}
          <View style={styles.lineItem}><Text style={styles.section}>Total</Text><Text style={styles.refundValue}>{money(pricing.total)}</Text></View>
          <Text style={styles.hint}>Payment {booking?.paymentStatus || 'unknown'}</Text>
          <TouchableOpacity onPress={() => setBill(false)} accessibilityRole="button"><Text style={styles.link}>Close</Text></TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
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
  page: { padding: 16, paddingTop: 4, paddingBottom: 16 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E8ECF0', padding: 14, marginBottom: 12 },
  vehicle: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  photo: { width: 92, height: 68, borderRadius: 12, backgroundColor: '#F3F5F7', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoImage: { width: '100%', height: '100%' },
  emoji: { fontSize: 28 },
  vehicleName: { color: INK, fontSize: 16, fontWeight: '800' },
  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  spec: { color: '#3C4652', fontSize: 11, fontWeight: '700', backgroundColor: '#F4F6F8', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  steps: { flexDirection: 'row' },
  step: { flex: 1, alignItems: 'center' },
  line: { position: 'absolute', left: -12, right: 12, top: 9, height: 2, backgroundColor: '#E5E7EB' },
  lineOn: { backgroundColor: BUTTON },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#D5DBE1', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: BUTTON, borderColor: BUTTON },
  check: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  stepLabel: { color: MUTED, fontSize: 8, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  stepHint: { color: MUTED, fontSize: 8, textAlign: 'center', marginTop: 2 },
  stepOn: { color: GREEN },
  section: { color: INK, fontSize: 16, fontWeight: '800' },
  detailRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  kicker: { color: MUTED, fontSize: 11, fontWeight: '700' },
  place: { color: INK, fontSize: 13, fontWeight: '800', marginTop: 2 },
  time: { color: MUTED, fontSize: 11, marginTop: 2 },
  metric: { color: INK, fontSize: 16, fontWeight: '800', marginTop: 2 },
  link: { color: GREEN, fontWeight: '800', marginTop: 4 },
  map: { width: 96, height: 120, borderRadius: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badge: { color: GREEN, fontSize: 11, fontWeight: '800', backgroundColor: '#E7F8EC', borderRadius: 10, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4 },
  photoRow: { gap: 8 },
  tile: { width: 84 },
  tileImage: { width: 84, height: 64, borderRadius: 10, backgroundColor: '#F3F5F7' },
  tileLabel: { color: MUTED, fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  hint: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 4 },
  refundRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  minus: { color: MUTED, fontWeight: '800' },
  refundBox: { flex: 1, backgroundColor: '#F3FBF6', borderRadius: 12, padding: 8 },
  refundValue: { color: GREEN, fontSize: 16, fontWeight: '800', marginTop: 2 },
  review: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E8ECF0', padding: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  ghost: { flex: 1, height: 46, borderRadius: 23, borderWidth: 1, borderColor: '#E8ECF0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  ghostText: { color: INK, fontWeight: '800', fontSize: 12 },
  again: { flex: 1.2, height: 46, borderRadius: 23, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  againText: { color: '#FFFFFF', fontWeight: '800' },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E8ECF0', backgroundColor: '#FFFFFF' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabText: { color: MUTED, fontSize: 11, fontWeight: '700' },
  tabOn: { color: GREEN },
  backdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  lineItem: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  lineValue: { color: INK, fontWeight: '800' },
});
