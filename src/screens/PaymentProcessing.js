import React from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const INK = '#12161C';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const MUTED = '#6B7280';
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const imageOf = vehicle => [...(Array.isArray(vehicle?.images) ? vehicle.images : []), vehicle?.imageUrl, vehicle?.photoUrl].find(value => typeof value === 'string' && /^https?:\/\//i.test(value));

const STEPS = ['Payment Initiated', 'Waiting for Confirmation', 'Verifying Payment', 'Booking Confirmed'];

export default function PaymentProcessing({ vehicle, booking, quote, busy, error, state, onBack, onCancel }) {
  const pricing = quote || booking?.pricing || {};
  const total = pricing.total;
  const image = imageOf(vehicle);
  const specs = [vehicle?.fuel, vehicle?.transmission].filter(Boolean);
  if (Number(pricing.helmets) > 0) specs.push(`${pricing.helmets} extra helmet${Number(pricing.helmets) === 1 ? '' : 's'}`);
  const active = state === 'paid' ? 3 : state === 'opening' ? 0 : state === 'verifying' ? 2 : 1;
  const headline = state === 'failed' ? 'Payment was not confirmed' : state === 'blocked' ? 'Checkout could not open' : state === 'verifying' || busy ? 'Verifying payment...' : state === 'opening' ? 'Opening secure checkout...' : 'Waiting for payment';

  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backText}>←</Text></TouchableOpacity>
        <View>
          <Text style={styles.title}>Complete Payment</Text>
          <Text style={styles.sub}>Please complete the payment to confirm your booking</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.vehicle}>
          <View style={styles.photo}>{image ? <Image source={{ uri: image }} style={styles.photoImage} resizeMode="contain" /> : <Text style={styles.emoji}>{vehicle?.emoji || '🛵'}</Text>}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.vehicleName}>{vehicle?.name || booking?.vehicle || 'Selected vehicle'}</Text>
            <View style={styles.specs}>{specs.map(spec => <Text key={spec} style={styles.spec}>{spec}</Text>)}</View>
          </View>
        </View>
      </View>

      <View style={styles.amount}>
        <View>
          <Text style={styles.amountLabel}>Amount to Pay</Text>
          <Text style={styles.amountValue}>{total != null ? money(total) : '—'}</Text>
        </View>
        <View style={styles.secure}>
          <Text style={styles.secureTitle}>Secure Payment</Text>
          <Text style={styles.secureBody}>Your payment is completed in encrypted Cashfree checkout.</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Processing Payment</Text>
        <Text style={styles.sectionSub}>Complete the payment in secure checkout to confirm your booking</Text>
        <View style={styles.spinner}><ActivityIndicator size="large" color={BUTTON} /></View>
        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.sectionSub}>Please complete the payment, then return to RideOn</Text>
        <View style={styles.steps}>
          {STEPS.map((label, index) => <View key={label} style={styles.step}>
            {index > 0 && <View style={[styles.line, index <= active && styles.lineOn]} />}
            <View style={[styles.dot, index < active && styles.dotDone, index === active && styles.dotNow]}>
              {index < active ? <Text style={styles.dotCheck}>✓</Text> : null}
            </View>
            <Text style={[styles.stepLabel, index <= active && styles.stepLabelOn]}>{label}</Text>
          </View>)}
        </View>
        <View style={styles.note}>
          <Text style={styles.noteText}>Secure checkout opens for UPI, card, or net banking. Complete the payment there and return to this screen. RideOn confirms the booking only after the payment is verified.</Text>
        </View>
        {!!error && state !== 'pending' && state !== 'opening' && state !== 'verifying' && <Text style={styles.error}>{error}</Text>}
      </View>
    </ScrollView>
    <TouchableOpacity style={styles.cancel} onPress={onCancel} accessibilityRole="button">
      <Text style={styles.cancelText}>Cancel Payment</Text>
    </TouchableOpacity>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8FA' },
  page: { padding: 16, paddingBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 22, color: INK },
  title: { color: INK, fontSize: 20, fontWeight: '800' },
  sub: { color: MUTED, fontSize: 12, marginTop: 2 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E8ECF0', padding: 14, marginBottom: 12 },
  vehicle: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  photo: { width: 92, height: 72, borderRadius: 12, backgroundColor: '#F3F5F7', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoImage: { width: '100%', height: '100%' },
  emoji: { fontSize: 32 },
  vehicleName: { color: INK, fontSize: 16, fontWeight: '800' },
  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  spec: { color: '#3C4652', fontSize: 11, fontWeight: '700', backgroundColor: '#F4F6F8', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  amount: { backgroundColor: '#F3FBF6', borderRadius: 18, borderWidth: 1, borderColor: '#D7F0E2', padding: 14, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  amountLabel: { color: MUTED, fontSize: 12 },
  amountValue: { color: INK, fontSize: 28, fontWeight: '800', marginTop: 4 },
  secure: { flex: 1 },
  secureTitle: { color: GREEN, fontSize: 13, fontWeight: '800' },
  secureBody: { color: MUTED, fontSize: 11, lineHeight: 16, marginTop: 4 },
  section: { color: INK, fontSize: 18, fontWeight: '800' },
  sectionSub: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 4, textAlign: 'center' },
  spinner: { alignSelf: 'center', width: 88, height: 88, borderRadius: 44, borderWidth: 4, borderColor: '#D7F0E2', alignItems: 'center', justifyContent: 'center', marginVertical: 18 },
  headline: { color: INK, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  steps: { flexDirection: 'row', marginTop: 22 },
  step: { flex: 1, alignItems: 'center' },
  line: { position: 'absolute', left: -18, right: 18, top: 10, height: 2, backgroundColor: '#E5E7EB' },
  lineOn: { backgroundColor: BUTTON },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#D5DBE1', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: BUTTON, borderColor: BUTTON },
  dotNow: { borderColor: BUTTON },
  dotCheck: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  stepLabel: { color: MUTED, fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  stepLabelOn: { color: GREEN },
  note: { backgroundColor: '#F3FBF6', borderRadius: 12, padding: 12, marginTop: 16 },
  noteText: { color: '#3C4652', fontSize: 12, lineHeight: 17 },
  error: { color: '#B23B3B', fontWeight: '700', marginTop: 10 },
  cancel: { margin: 16, height: 52, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8ECF0', alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: GREEN, fontSize: 16, fontWeight: '800' },
});
