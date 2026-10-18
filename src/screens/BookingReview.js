import React from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const INK = '#12161C';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
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

export default function BookingReview({ vehicle, date, pickupTime, returnDate, returnTime, duration, city, delivery, address, quote, helmets = 0, holders = 0, busy, error, onBack, onChangeDetails, onChangeLocation, onChangeAddons, onConfirm }) {
  const image = imageOf(vehicle);
  const rental = quote?.rental;
  const deposit = Number(quote?.securityDeposit || 0);
  const fee = Number(quote?.platformFee || 0);
  const deliveryFee = Number(quote?.deliveryFee || 0);
  const total = quote?.total;
  const days = duration || quote?.days || 1;
  const specs = [vehicle?.fuel, vehicle?.transmission, vehicle?.type].filter(Boolean);
  const place = delivery ? (address || 'Delivery address') : (city || 'Pickup');
  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backText}>←</Text></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Booking Review</Text>
          <Text style={styles.sub}>Please review your booking details</Text>
        </View>
      </View>
      <View style={styles.steps}>
        {['Vehicle', 'Review', 'Confirm', 'Payment', 'Done'].map((label, index) => <View key={label} style={styles.step}><View style={[styles.dot, index <= 1 && styles.dotOn]}><Text style={[styles.dotText, index <= 1 && styles.dotTextOn]}>{index + 1}</Text></View><Text style={[styles.stepLabel, index === 1 && styles.stepLabelOn]}>{label}</Text></View>)}
      </View>

      <View style={styles.card}>
        <View style={styles.vehicleRow}>
          <View style={styles.thumb}>{image ? <Image source={{ uri: image }} style={styles.thumbImage} /> : <Text style={styles.emoji}>{vehicle?.emoji || '🛵'}</Text>}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.vehicleName}>{vehicle?.name || 'Selected vehicle'}</Text>
            <Text style={styles.specs}>{specs.join('  ·  ') || 'RideOn vehicle'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}><Text style={styles.cardTitle}>Date & Time</Text><TouchableOpacity onPress={onChangeDetails}><Text style={styles.change}>Change</Text></TouchableOpacity></View>
        <View style={styles.when}>
          <View style={styles.whenCol}><Text style={styles.whenLabel}>Pickup</Text><Text style={styles.whenValue}>{dayLabel(date, pickupTime)}</Text><Text style={styles.whenTime}>{clock(pickupTime)}</Text></View>
          <Text style={styles.arrow}>→</Text>
          <View style={styles.whenCol}><Text style={styles.whenLabel}>Drop-off</Text><Text style={styles.whenValue}>{dayLabel(returnDate, returnTime)}</Text><Text style={styles.whenTime}>{clock(returnTime)}</Text></View>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}><Text style={styles.cardTitle}>{delivery ? 'Delivery location' : 'Pickup location'}</Text><TouchableOpacity onPress={onChangeLocation || onChangeDetails}><Text style={styles.change}>Change</Text></TouchableOpacity></View>
        <Text style={styles.place}>{place}</Text>
        <Text style={styles.placeSub}>{delivery ? 'Doorstep delivery' : `Collect in ${city || 'your city'}`}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pricing Details</Text>
        <Line label={`Base price (${days} day${days === 1 ? '' : 's'})`} value={money(rental != null ? rental : 0)} />
        {deliveryFee > 0 && <Line label="Delivery fee" value={money(deliveryFee)} />}
        <Line label="Security deposit" value={money(deposit)} />
        <Line label="Convenience fee" value={money(fee)} />
        {Number(quote?.addonFee) > 0 && <Line label="Add-ons" value={money(quote.addonFee)} />}
        <View style={styles.totalRow}><Text style={styles.totalLabel}>Total payable</Text><Text style={styles.totalValue}>{total != null ? money(total) : '—'}</Text></View>
        {deposit > 0 && <Text style={styles.refund}>The security deposit is refundable after the vehicle is returned.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add-ons</Text>
        <Stepper label="Extra helmet" hint="₹50 each" value={helmets} max={4} disabled={busy} onChange={value => onChangeAddons?.({ helmets: value, holders })} />
        <Stepper label="Mobile holder" hint={`₹50 × ${days} day${days === 1 ? '' : 's'}`} value={holders} max={2} disabled={busy} onChange={value => onChangeAddons?.({ helmets, holders: value })} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>What's included</Text>
        {helmets > 0 && <Text style={styles.remember}>• {helmets} extra helmet{helmets === 1 ? '' : 's'}</Text>}
        {holders > 0 && <Text style={styles.remember}>• {holders} mobile holder{holders === 1 ? '' : 's'}</Text>}
        {helmets + holders === 0 && <Text style={styles.placeSub}>No extra helmets or holders are added. You can add them above.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Things to remember</Text>
        <Text style={styles.remember}>• A verified driving licence is required before payment.</Text>
        <Text style={styles.remember}>• The security deposit stays with the booking until the return inspection.</Text>
        <Text style={styles.remember}>• Damage found on return can be deducted from the deposit.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Payment</Text>
        <Text style={styles.payName}>Cashfree checkout</Text>
        <Text style={styles.placeSub}>You pay the total above in secure checkout. RideOn does not store a UPI ID here.</Text>
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
    <View style={styles.footer}>
      <TouchableOpacity style={styles.button} onPress={onConfirm} disabled={busy} accessibilityRole="button">
        <Text style={styles.buttonText}>{busy ? 'Confirming…' : `Confirm & proceed to payment${total != null ? `  ·  ${money(total)}` : ''}`}</Text>
      </TouchableOpacity>
      <Text style={styles.legal}>By confirming, you agree to the booking terms and the price shown above.</Text>
    </View>
  </View>;
}

function Line({ label, value }) {
  return <View style={styles.line}><Text style={styles.lineLabel}>{label}</Text><Text style={styles.lineValue}>{value}</Text></View>;
}

function Stepper({ label, hint, value, max, disabled, onChange }) {
  return <View style={styles.stepper}>
    <View style={{ flex: 1 }}><Text style={styles.lineLabel}>{label}</Text><Text style={styles.placeSub}>{hint}</Text></View>
    <TouchableOpacity style={styles.stepBtn} disabled={disabled || value <= 0} onPress={() => onChange(value - 1)} accessibilityRole="button" accessibilityLabel={`Remove ${label}`}><Text style={styles.stepBtnText}>−</Text></TouchableOpacity>
    <Text style={styles.stepValue}>{value}</Text>
    <TouchableOpacity style={styles.stepBtn} disabled={disabled || value >= max} onPress={() => onChange(value + 1)} accessibilityRole="button" accessibilityLabel={`Add ${label}`}><Text style={styles.stepBtnText}>+</Text></TouchableOpacity>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8FA' },
  page: { padding: 16, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 22, color: INK },
  title: { color: INK, fontSize: 18, fontWeight: '800' },
  sub: { color: '#7B848E', fontSize: 12, marginTop: 2 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginBottom: 12 },
  vehicleRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb: { width: 84, height: 64, borderRadius: 12, backgroundColor: '#F4F6F8', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbImage: { width: '100%', height: '100%' },
  emoji: { fontSize: 28 },
  vehicleName: { color: INK, fontSize: 16, fontWeight: '800' },
  specs: { color: '#66707A', fontSize: 12, marginTop: 4 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardTitle: { color: INK, fontSize: 15, fontWeight: '800' },
  change: { color: GREEN, fontWeight: '800' },
  when: { flexDirection: 'row', alignItems: 'center' },
  whenCol: { flex: 1 },
  whenLabel: { color: '#7B848E', fontSize: 11 },
  whenValue: { color: INK, fontWeight: '800', marginTop: 4 },
  whenTime: { color: '#3E4A54', marginTop: 2 },
  arrow: { color: GREEN, fontSize: 18, marginHorizontal: 8 },
  place: { color: INK, fontWeight: '800' },
  placeSub: { color: '#66707A', fontSize: 12, marginTop: 3 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  lineLabel: { color: '#5E6872', fontSize: 13 },
  lineValue: { color: INK, fontWeight: '700' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EEF1F4' },
  totalLabel: { color: INK, fontSize: 16, fontWeight: '800' },
  totalValue: { color: INK, fontSize: 18, fontWeight: '800' },
  refund: { marginTop: 10, color: GREEN, fontSize: 12, lineHeight: 17 },
  payName: { color: INK, fontWeight: '800', marginTop: 8 },
  remember: { color: '#3E4A54', fontSize: 13, lineHeight: 20, marginTop: 6 },
  steps: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  step: { alignItems: 'center', flex: 1 },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#E6E8EC', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: BUTTON },
  dotText: { color: '#66707A', fontSize: 11, fontWeight: '800' },
  dotTextOn: { color: '#FFFFFF' },
  stepLabel: { color: '#8B949E', fontSize: 10, marginTop: 4 },
  stepLabelOn: { color: GREEN, fontWeight: '800' },
  error: { color: '#B23B3B', fontWeight: '700', marginBottom: 8 },
  footer: { padding: 16, paddingTop: 8, backgroundColor: '#F7F8FA' },
  button: { height: 54, borderRadius: 27, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  legal: { textAlign: 'center', color: '#8B949E', fontSize: 12, marginTop: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  stepBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#E7F8EC', alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: GREEN, fontSize: 18, fontWeight: '800' },
  stepValue: { minWidth: 18, textAlign: 'center', color: INK, fontWeight: '800' },
});
