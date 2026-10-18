import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { rideOnApi } from '../services/api';

const INK = '#12161C';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const MUTED = '#6B7280';
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const imageOf = vehicle => [...(Array.isArray(vehicle?.images) ? vehicle.images : []), vehicle?.imageUrl].find(value => typeof value === 'string' && /^https?:\/\//i.test(value));
const parsedDate = value => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};
const dayOf = value => parsedDate(value)?.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) || '';
const timeOf = value => parsedDate(value)?.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) || '';
const stampOf = value => parsedDate(value)?.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) || '';

export default function DepositSettlement({ booking, vehicle, onBack, onDetails }) {
  const [report, setReport] = useState(null);
  const deposit = Number(booking?.pricing?.securityDeposit || 0);
  const deduction = Number(booking?.securityDepositDeduction || 0);
  const recordedRefund = Number(booking?.securityDepositRefundable || 0);
  const status = String(booking?.securityDepositStatus || '').toLowerCase();
  const refunded = ['refunded', 'settled', 'released'].includes(status);
  const pendingRefund = status === 'refund_pending';
  const fullyDeducted = deposit > 0 && (status === 'deducted' || deduction >= deposit);
  const held = Math.max(0, deposit - deduction);
  const refundAmount = refunded ? (recordedRefund || held) : held;
  const lifecycle = String(booking?.lifecycleState || '').toUpperCase();
  const returned = ['RETURN_REQUESTED', 'PICKUP_STARTED', 'RETURNED', 'COMPLETED'].includes(lifecycle) || Boolean(booking?.returnRequestedAt);
  const inspectionAt = report?.capturedAt || booking?.securityDepositInspectedAt;
  const inspected = Boolean(inspectionAt) || Boolean(report);
  const tripDone = ['RETURNED', 'COMPLETED'].includes(lifecycle) || String(booking?.status || '').toLowerCase() === 'completed';
  const place = booking?.returnLocation || booking?.address || '';
  const image = imageOf(vehicle) || imageOf(booking);
  const helmets = Number(String(booking?.raw?.notes || booking?.notes || '').match(/(\d+)\s+extra helmet/i)?.[1] || 0);
  const specs = [vehicle?.fuel, vehicle?.transmission, vehicle?.registrationNumber, helmets > 0 ? `${helmets} extra helmet${helmets === 1 ? '' : 's'}` : ''].filter(Boolean);
  const dropoff = booking?.deliveryLatitude != null && booking?.deliveryLongitude != null ? { latitude: Number(booking.deliveryLatitude), longitude: Number(booking.deliveryLongitude) } : null;
  const load = useCallback(async () => {
    if (!booking?.id) return;
    try {
      const result = await rideOnApi.getConditionEvidence(booking.id);
      const mine = (result?.reports || []).find(item => item.phase === 'pickup');
      setReport(mine || null);
    } catch { setReport(null); }
  }, [booking?.id]);
  useEffect(() => { load(); }, [load]);
  const openMap = () => {
    const target = dropoff ? `${dropoff.latitude},${dropoff.longitude}` : place;
    if (!target) return;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`).catch(() => {});
  };
  const badge = deposit <= 0 ? '' : refunded ? 'Refunded' : fullyDeducted ? 'Deducted' : 'Refundable after inspection';
  const processing = deposit <= 0
    ? 'This booking has no security deposit.'
    : refunded
      ? 'The refund has been sent to your original payment method.'
      : pendingRefund
        ? 'The refund is waiting for confirmation from the payment provider.'
        : 'RideOn releases this deposit to your original payment method after the return inspection.';
  const steps = [
    ['Trip in Progress', true],
    ['Return Inspection', inspected || returned],
    ['Deposit Settlement', refunded || fullyDeducted],
    ['Trip Completed', tripDone],
  ];
  const progress = [
    ['Vehicle Returned', returned, stampOf(booking?.returnRequestedAt) || (returned ? 'Requested' : 'Pending')],
    ['Inspection Completed', inspected, stampOf(inspectionAt) || (inspected ? 'Recorded' : 'Pending')],
    ['Deposit Processing', refunded, pendingRefund ? 'With the payment provider' : 'After inspection'],
    ['Refund Completed', refunded || (deposit <= 0), refunded ? 'Sent' : deposit <= 0 ? 'No deposit' : 'Pending'],
  ];

  return <View style={styles.root}>
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backText}>←</Text></TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Deposit Settlement</Text>
        <Text style={styles.sub}>{returned ? 'Your return is with RideOn. This is the deposit on the booking.' : 'The deposit stays with this booking until the vehicle is returned.'}</Text>
      </View>
    </View>
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <View style={styles.steps}>
          {steps.map(([label, done], index) => <View key={label} style={styles.step}>
            {index > 0 && <View style={[styles.line, done && styles.lineOn]} />}
            <View style={[styles.dot, done && styles.dotOn, !done && index === 2 && styles.dotNow]}>{done ? <Text style={styles.check}>✓</Text> : null}</View>
            <Text style={[styles.stepLabel, (done || index === 2) && styles.stepOn]}>{label}</Text>
          </View>)}
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
      <View style={styles.card}>
        <View style={styles.whenRow}>
          <View style={styles.when}><Text style={styles.kicker}>Pickup</Text><Text style={styles.place}>{dayOf(booking?.pickupAt) || 'On the booking'}</Text>{!!timeOf(booking?.pickupAt) && <Text style={styles.time}>{timeOf(booking.pickupAt)}</Text>}</View>
          <View style={styles.when}><Text style={styles.kicker}>Drop-off</Text><Text style={styles.place}>{dayOf(booking?.returnAt) || 'On the booking'}</Text>{!!timeOf(booking?.returnAt) && <Text style={styles.time}>{timeOf(booking.returnAt)}</Text>}</View>
          <View style={styles.when}><Text style={styles.kicker}>Return location</Text><Text style={styles.place}>{place || 'On the booking'}</Text><TouchableOpacity onPress={openMap} accessibilityRole="button"><Text style={styles.link}>View Map</Text></TouchableOpacity></View>
        </View>
      </View>
      <View style={styles.depositCard}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.section}>Security Deposit</Text>
            <Text style={styles.amount}>{money(deposit)}</Text>
          </View>
          {!!badge && <Text style={styles.badge}>{badge}</Text>}
        </View>
        <Text style={styles.hint}>{processing}</Text>
      </View>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.section}>Return Inspection</Text>
          {inspected && <Text style={styles.badge}>Inspection recorded</Text>}
        </View>
        <View style={styles.steps}>
          {progress.map(([label, done, hint], index) => <View key={label} style={styles.step}>
            {index > 0 && <View style={[styles.line, done && styles.lineOn]} />}
            <View style={[styles.dot, done && styles.dotOn, !done && index === 2 && styles.dotNow]}>{done ? <Text style={styles.check}>✓</Text> : null}</View>
            <Text style={[styles.stepLabel, done && styles.stepOn]}>{label}</Text>
            {!!hint && <Text style={styles.stepHint}>{hint}</Text>}
          </View>)}
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>Refund Summary</Text>
        <View style={styles.lineItem}><Text style={styles.hint}>Security deposit</Text><Text style={styles.lineValue}>{money(deposit)}</Text></View>
        <View style={styles.lineItem}><Text style={styles.hint}>Deductions</Text><Text style={styles.lineValue}>{money(deduction)}</Text></View>
        {!!booking?.securityDepositReason && <Text style={styles.hint}>{booking.securityDepositReason}</Text>}
        <View style={styles.total}><Text style={styles.section}>{refunded ? 'Refund amount' : 'Held for refund'}</Text><Text style={styles.totalValue}>{money(refundAmount)}</Text></View>
      </View>
      <View style={styles.note}><Text style={styles.section}>Deposit status</Text><Text style={styles.hint}>{processing}</Text></View>
      <TouchableOpacity style={styles.submit} onPress={onDetails} accessibilityRole="button"><Text style={styles.submitText}>View Trip Details</Text></TouchableOpacity>
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
  page: { padding: 16, paddingTop: 8, paddingBottom: 28 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E8ECF0', padding: 14, marginBottom: 12 },
  steps: { flexDirection: 'row' },
  step: { flex: 1, alignItems: 'center' },
  line: { position: 'absolute', left: -16, right: 16, top: 9, height: 2, backgroundColor: '#E5E7EB' },
  lineOn: { backgroundColor: BUTTON },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D5DBE1', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: BUTTON, borderColor: BUTTON },
  dotNow: { borderColor: BUTTON },
  check: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  stepLabel: { color: MUTED, fontSize: 9, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  stepHint: { color: MUTED, fontSize: 8, textAlign: 'center', marginTop: 2 },
  stepOn: { color: GREEN },
  vehicle: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  photo: { width: 92, height: 68, borderRadius: 12, backgroundColor: '#F3F5F7', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoImage: { width: '100%', height: '100%' },
  emoji: { fontSize: 28 },
  vehicleName: { color: INK, fontSize: 16, fontWeight: '800' },
  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  spec: { color: '#3C4652', fontSize: 11, fontWeight: '700', backgroundColor: '#F4F6F8', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  whenRow: { flexDirection: 'row', gap: 8 },
  when: { flex: 1 },
  kicker: { color: MUTED, fontSize: 11, fontWeight: '700' },
  place: { color: INK, fontSize: 12, fontWeight: '800', marginTop: 4 },
  time: { color: MUTED, fontSize: 11, marginTop: 2 },
  link: { color: GREEN, fontWeight: '800', marginTop: 4, fontSize: 12 },
  depositCard: { backgroundColor: '#F3FBF6', borderRadius: 18, padding: 14, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  section: { color: INK, fontSize: 16, fontWeight: '800' },
  amount: { color: INK, fontSize: 28, fontWeight: '800', marginTop: 4 },
  badge: { color: GREEN, fontSize: 11, fontWeight: '800', backgroundColor: '#E7F8EC', borderRadius: 10, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4 },
  hint: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 6 },
  lineItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  lineValue: { color: INK, fontWeight: '800' },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F3FBF6', borderRadius: 12, padding: 12, marginTop: 12 },
  totalValue: { color: GREEN, fontSize: 20, fontWeight: '800' },
  note: { backgroundColor: '#F4F7FB', borderRadius: 16, padding: 14, marginBottom: 12 },
  submit: { height: 52, borderRadius: 26, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
