import React, { useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const INK = '#12161C';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const MUTED = '#6B7280';
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const clock = value => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return value || '';
  let hour = Number(match[1]);
  const period = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${match[2]} ${period}`;
};
const dayLabel = (date, time) => {
  if (!date) return 'Not set';
  const parsed = new Date(`${date}T${time || '10:00'}:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const imageOf = vehicle => [...(Array.isArray(vehicle?.images) ? vehicle.images : []), vehicle?.imageUrl, vehicle?.photoUrl].find(value => typeof value === 'string' && /^https?:\/\//i.test(value));

const LEGAL = {
  terms: {
    title: 'Terms & Conditions',
    body: 'The amount on this screen is the RideOn quote for this booking. Pay opens secure Cashfree checkout. The booking stays unpaid until RideOn verifies the payment. Identity verification is required before payment.',
  },
  cancellation: {
    title: 'Cancellation Policy',
    body: 'You can review this booking from My bookings. A payment is confirmed only after RideOn verifies it with Cashfree. A security deposit shown here is refundable after the vehicle is returned.',
  },
};

export default function PaymentScreen({ vehicle, booking, date, pickupTime, returnDate, returnTime, duration, city, delivery, address, quote, busy, error, state, onBack, onChangeDetails, onPay, onRefresh, onTrips }) {
  const [method, setMethod] = useState('upi');
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [legal, setLegal] = useState('');
  const pricing = quote || booking?.pricing || {};
  const rental = Number(pricing.rental || 0);
  const deposit = Number(pricing.securityDeposit || 0);
  const fee = Number(pricing.platformFee || 0);
  const deliveryFee = Number(pricing.deliveryFee || 0);
  const addonFee = Number(pricing.addonFee || 0);
  const total = pricing.total;
  const days = duration || pricing.days || 1;
  const image = imageOf(vehicle);
  const specs = [vehicle?.fuel, vehicle?.transmission].filter(Boolean);
  if (Number(pricing.helmets) > 0) specs.push(`${pricing.helmets} extra helmet${Number(pricing.helmets) === 1 ? '' : 's'}`);
  const place = delivery ? (address || 'Delivery address') : (city || 'Pickup');
  const payLabel = method === 'card' ? 'card' : method === 'bank' ? 'net banking' : 'UPI';
  const showPay = state !== 'blocked' && state !== 'pending_verification' && state !== 'paid';
  const showRefresh = state === 'pending_verification' || state === 'pending' || state === 'blocked' || state === 'failed';
  const sheet = LEGAL[legal];

  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backText}>←</Text></TouchableOpacity>
        <View>
          <Text style={styles.title}>Payment</Text>
          <Text style={styles.sub}>Choose a payment method to confirm your booking</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.vehicle}>
          <View style={styles.photo}>{image ? <Image source={{ uri: image }} style={styles.photoImage} resizeMode="contain" /> : <Text style={styles.emoji}>{vehicle?.emoji || '🛵'}</Text>}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.vehicleName}>{vehicle?.name || booking?.vehicleName || 'Selected vehicle'}</Text>
            <View style={styles.specs}>
              {specs.map(spec => <View key={spec} style={styles.spec}><Text style={styles.specText}>{spec}</Text></View>)}
            </View>
          </View>
        </View>
        <View style={styles.trip}>
          <View style={styles.when}>
            <Text style={styles.whenLabel}>Pickup</Text>
            <Text style={styles.whenValue}>{dayLabel(date, pickupTime)}</Text>
            <Text style={styles.whenTime}>{clock(pickupTime)}</Text>
          </View>
          <Text style={styles.arrow}>→</Text>
          <View style={styles.when}>
            <Text style={styles.whenLabel}>Drop-off</Text>
            <Text style={styles.whenValue}>{dayLabel(returnDate, returnTime)}</Text>
            <Text style={styles.whenTime}>{clock(returnTime)}</Text>
          </View>
          <View style={styles.where}>
            <Text style={styles.whenLabel}>Pickup Location</Text>
            <Text style={styles.whereValue} numberOfLines={2}>{place}</Text>
            <TouchableOpacity onPress={onChangeDetails} accessibilityRole="button"><Text style={styles.change}>Change</Text></TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.amount}>
        <View style={styles.amountHead}>
          <Text style={styles.amountTitle}>Amount to Pay</Text>
          <TouchableOpacity onPress={() => setDetailsOpen(open => !open)} accessibilityRole="button">
            <Text style={styles.viewDetails}>View Details {detailsOpen ? '⌃' : '⌄'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.amountBody}>
          <View>
            <Text style={styles.totalLabel}>Total Payable</Text>
            <Text style={styles.totalValue}>{total != null ? money(total) : '—'}</Text>
          </View>
          {detailsOpen && <View style={styles.breakdown}>
            <Row label={`Rental Charges (${days} day${days === 1 ? '' : 's'})`} value={money(rental)} />
            {deliveryFee > 0 && <Row label="Delivery fee" value={money(deliveryFee)} />}
            {addonFee > 0 && <Row label="Add-ons" value={money(addonFee)} />}
            <Row label="Security Deposit" value={money(deposit)} />
            <Row label="Convenience Fee" value={money(fee)} />
          </View>}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.methodHead}>
          <Text style={styles.amountTitle}>Select Payment Method</Text>
          <Text style={styles.secure}>100% Secure Payments</Text>
        </View>
        <TouchableOpacity style={[styles.method, method === 'upi' && styles.methodOn]} onPress={() => setMethod('upi')} accessibilityRole="radio" accessibilityState={{ selected: method === 'upi' }}>
          <View style={styles.upiMark}><Text style={styles.upiMarkText}>UPI</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.methodName}>UPI Payment</Text>
            <Text style={styles.methodHint}>Pay using Google Pay, PhonePe, Paytm or any UPI app in secure checkout</Text>
          </View>
          <Radio on={method === 'upi'} />
        </TouchableOpacity>
        <View style={styles.apps}>
          {['Google Pay', 'PhonePe', 'Paytm', 'Other UPI'].map(name => <View key={name} style={styles.app}><Text style={styles.appName}>{name}</Text></View>)}
        </View>
        <View style={styles.or}><View style={styles.orLine} /><Text style={styles.orText}>OR</Text><View style={styles.orLine} /></View>
        <TouchableOpacity style={[styles.method, method === 'card' && styles.methodOn]} onPress={() => setMethod('card')} accessibilityRole="radio" accessibilityState={{ selected: method === 'card' }}>
          <Text style={styles.methodIcon}>▭</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.methodName}>Debit / Credit Card</Text>
            <Text style={styles.methodHint}>Visa, Mastercard, RuPay in secure checkout</Text>
          </View>
          <Radio on={method === 'card'} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.method, styles.methodGap, method === 'bank' && styles.methodOn]} onPress={() => setMethod('bank')} accessibilityRole="radio" accessibilityState={{ selected: method === 'bank' }}>
          <Text style={styles.methodIcon}>⌂</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.methodName}>Net Banking</Text>
            <Text style={styles.methodHint}>Major banks in secure checkout</Text>
          </View>
          <Radio on={method === 'bank'} />
        </TouchableOpacity>
      </View>

      {!!error && <Text style={state === 'pending' || state === 'pending_verification' ? styles.notice : styles.error}>{error}</Text>}
      {state === 'failed' && <TouchableOpacity onPress={onPay} disabled={busy} accessibilityRole="button"><Text style={styles.link}>{busy ? 'Retrying…' : 'Retry payment'}</Text></TouchableOpacity>}
      {showRefresh && <TouchableOpacity onPress={onRefresh} disabled={busy} accessibilityRole="button"><Text style={styles.link}>{busy ? 'Refreshing…' : 'Refresh payment status'}</Text></TouchableOpacity>}
      <TouchableOpacity onPress={onTrips} accessibilityRole="button"><Text style={styles.link}>View my bookings</Text></TouchableOpacity>
    </ScrollView>
    <View style={styles.footer}>
      {showPay && <TouchableOpacity style={styles.button} onPress={onPay} disabled={busy || total == null} accessibilityRole="button">
        <Text style={styles.buttonText}>{busy ? 'Opening checkout…' : `Pay  ${total != null ? money(total) : ''}  with ${payLabel}  →`}</Text>
      </TouchableOpacity>}
      <Text style={styles.legal}>By proceeding, you agree to our <Text style={styles.legalLink} onPress={() => setLegal('terms')}>Terms & Conditions</Text> and <Text style={styles.legalLink} onPress={() => setLegal('cancellation')}>Cancellation Policy</Text></Text>
    </View>
    <Modal visible={!!sheet} animationType="slide" onRequestClose={() => setLegal('')}>
      <SafeAreaView style={styles.sheet}>
        <Text style={styles.sheetTitle}>{sheet?.title}</Text>
        <Text style={styles.sheetBody}>{sheet?.body}</Text>
        <TouchableOpacity style={styles.button} onPress={() => setLegal('')} accessibilityRole="button"><Text style={styles.buttonText}>Close</Text></TouchableOpacity>
      </SafeAreaView>
    </Modal>
  </View>;
}

function Row({ label, value }) {
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue}>{value}</Text></View>;
}
function Radio({ on }) {
  return <View style={[styles.radio, on && styles.radioOn]}>{on ? <Text style={styles.radioCheck}>✓</Text> : null}</View>;
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
  spec: { backgroundColor: '#F4F6F8', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  specText: { color: '#3C4652', fontSize: 11, fontWeight: '700' },
  trip: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EEF1F4' },
  when: { flex: 1 },
  whenLabel: { color: MUTED, fontSize: 11 },
  whenValue: { color: INK, fontSize: 12, fontWeight: '700', marginTop: 3 },
  whenTime: { color: MUTED, fontSize: 11, marginTop: 2 },
  arrow: { color: MUTED, marginTop: 16, marginHorizontal: 4 },
  where: { flex: 1.1 },
  whereValue: { color: INK, fontSize: 12, fontWeight: '700', marginTop: 3 },
  change: { color: GREEN, fontSize: 12, fontWeight: '700', marginTop: 4 },
  amount: { backgroundColor: '#F3FBF6', borderRadius: 18, borderWidth: 1, borderColor: '#D7F0E2', padding: 14, marginBottom: 12 },
  amountHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amountTitle: { color: INK, fontSize: 16, fontWeight: '800' },
  viewDetails: { color: GREEN, fontSize: 12, fontWeight: '700' },
  amountBody: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 12 },
  totalLabel: { color: MUTED, fontSize: 12 },
  totalValue: { color: GREEN, fontSize: 28, fontWeight: '800', marginTop: 2 },
  breakdown: { flex: 1, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  rowLabel: { color: MUTED, fontSize: 11, flex: 1 },
  rowValue: { color: INK, fontSize: 11, fontWeight: '700' },
  methodHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  secure: { color: GREEN, fontSize: 11, fontWeight: '700' },
  method: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#E8ECF0', borderRadius: 14, padding: 12 },
  methodOn: { borderColor: '#8ED9B4', backgroundColor: '#F3FBF6' },
  methodGap: { marginTop: 8 },
  upiMark: { width: 42, height: 28, borderRadius: 6, borderWidth: 1, borderColor: '#E8ECF0', alignItems: 'center', justifyContent: 'center' },
  upiMarkText: { color: '#5B6470', fontSize: 11, fontWeight: '800' },
  methodIcon: { width: 28, textAlign: 'center', color: '#5B6470', fontSize: 16 },
  methodName: { color: INK, fontSize: 14, fontWeight: '800' },
  methodHint: { color: MUTED, fontSize: 11, lineHeight: 15, marginTop: 2 },
  apps: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, marginBottom: 4 },
  app: { width: 68, alignItems: 'center' },
  appName: { color: MUTED, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#D5DBE1', alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: BUTTON, borderColor: BUTTON },
  radioCheck: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  or: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 12 },
  orLine: { flex: 1, height: 1, backgroundColor: '#E8ECF0' },
  orText: { color: MUTED, fontSize: 11, fontWeight: '700' },
  error: { color: '#B23B3B', fontWeight: '700', marginBottom: 8 },
  notice: { color: MUTED, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  link: { color: GREEN, fontWeight: '700', marginBottom: 8 },
  footer: { padding: 16, paddingTop: 8, backgroundColor: '#F7F8FA' },
  button: { height: 54, borderRadius: 27, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  legal: { textAlign: 'center', color: MUTED, fontSize: 12, marginTop: 10, lineHeight: 18 },
  legalLink: { color: GREEN, fontWeight: '700' },
  sheet: { flex: 1, backgroundColor: '#FFFFFF', padding: 22 },
  sheetTitle: { color: INK, fontSize: 22, fontWeight: '800', marginBottom: 12 },
  sheetBody: { color: '#3C4652', fontSize: 15, lineHeight: 22 },
});
