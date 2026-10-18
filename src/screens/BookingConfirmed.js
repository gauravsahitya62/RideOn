import React, { useState } from 'react';
import { Image, Linking, Modal, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const INK = '#12161C';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const MUTED = '#6B7280';
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const clock = value => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
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
const fromIso = value => {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return { day: 'Not set', time: '' };
  return {
    day: parsed.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    time: parsed.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }),
  };
};
const stamp = value => {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};
const imageOf = vehicle => [...(Array.isArray(vehicle?.images) ? vehicle.images : []), ...(Array.isArray(vehicle?.imageUrls) ? vehicle.imageUrls : []), vehicle?.imageUrl, vehicle?.photoUrl].find(value => typeof value === 'string' && /^https?:\/\//i.test(value));
const calendarStamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export default function BookingConfirmed({ vehicle, booking, date, pickupTime, returnDate, returnTime, city, delivery, address, quote, onClose, onTrips, onHome, onHelp, onProfile, onMap }) {
  const [receipt, setReceipt] = useState(false);
  const pricing = booking?.pricing || quote || {};
  const paid = String(booking?.paymentStatus || '').toLowerCase() === 'paid';
  const status = String(booking?.status || '').toLowerCase();
  const confirmed = ['confirmed', 'in_progress', 'completed'].includes(status);
  const preparing = ['DELIVERY_STARTED', 'IN_DELIVERY', 'DELIVERED', 'ACTIVE_RENTAL'].includes(String(booking?.lifecycleState || '').toUpperCase());
  const image = imageOf(vehicle) || imageOf(booking);
  const specs = [vehicle?.fuel, vehicle?.transmission, booking?.vehicleType].filter(Boolean);
  const pickup = date ? { day: dayLabel(date, pickupTime), time: clock(pickupTime) } : fromIso(booking?.pickupAt);
  const dropoff = returnDate ? { day: dayLabel(returnDate, returnTime), time: clock(returnTime) } : fromIso(booking?.returnAt);
  const place = delivery ? (address || booking?.address || 'Delivery address') : (booking?.address || city || 'Pickup');
  const created = stamp(booking?.createdAt);
  const steps = [
    ['Booking Created', true, created || 'Saved'],
    ['Payment Successful', paid, paid ? 'Verified' : 'Pending'],
    ['Confirmed', confirmed, confirmed ? 'Accepted' : 'Waiting for RideOn'],
    ['Vehicle Preparing', preparing, preparing ? 'In progress' : 'Before pickup'],
  ];
  const deposit = Number(pricing.securityDeposit || 0);
  const share = () => Share.share({
    message: `RideOn booking ${booking?.id || ''}\n${vehicle?.name || booking?.vehicle || 'Vehicle'}\nPickup ${pickup.day} ${pickup.time}\nDrop-off ${dropoff.day} ${dropoff.time}\n${place}\n${pricing.total != null ? money(pricing.total) : ''}`.trim(),
  }).catch(() => {});
  const addToCalendar = () => {
    const start = date ? new Date(`${date}T${pickupTime || '10:00'}:00`) : new Date(booking?.pickupAt);
    const end = returnDate ? new Date(`${returnDate}T${returnTime || '10:00'}:00`) : new Date(booking?.returnAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`RideOn · ${vehicle?.name || booking?.vehicle || 'Booking'}`)}&dates=${calendarStamp(start)}/${calendarStamp(end)}&details=${encodeURIComponent(`Booking ${booking?.id || ''}`)}&location=${encodeURIComponent(place)}`;
    Linking.openURL(url).catch(() => {});
  };

  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.top}>
        <View style={styles.check}><Text style={styles.checkText}>✓</Text></View>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}><Text style={styles.closeText}>×</Text></TouchableOpacity>
      </View>
      <Text style={styles.title}>{paid ? 'Booking Confirmed!' : 'Booking saved'}</Text>
      <Text style={styles.sub}>{paid ? 'Your payment was verified and this booking is saved in RideOn.' : 'This booking is saved. Payment is still being confirmed.'}</Text>

      <View style={styles.card}>
        <View style={styles.vehicle}>
          <View style={styles.photo}>{image ? <Image source={{ uri: image }} style={styles.photoImage} resizeMode="contain" /> : <Text style={styles.emoji}>🛵</Text>}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.vehicleName}>{vehicle?.name || booking?.vehicle || 'Selected vehicle'}</Text>
            <View style={styles.specs}>{[...new Set(specs)].map(spec => <Text key={spec} style={styles.spec}>{spec}</Text>)}</View>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.idCard} onPress={onTrips} accessibilityRole="button">
        <View style={{ flex: 1 }}>
          <Text style={styles.idLabel}>Booking ID</Text>
          <Text style={styles.idValue}>{booking?.id || '—'}</Text>
          <Text style={styles.idHint}>Saved to your RideOn bookings.</Text>
        </View>
        <View style={styles.idSide}>
          <Text style={[styles.paid, paid && styles.paidOn]}>{paid ? 'Paid' : 'Unpaid'}</Text>
          <Text style={styles.total}>{pricing.total != null ? money(pricing.total) : ''}</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.card}>
        <View style={styles.rowHead}>
          <Text style={styles.section}>Booking Details</Text>
          <TouchableOpacity onPress={() => setReceipt(true)} accessibilityRole="button"><Text style={styles.link}>View receipt</Text></TouchableOpacity>
        </View>
        <View style={styles.trip}>
          <View style={styles.when}><Text style={styles.whenLabel}>Pickup</Text><Text style={styles.whenValue}>{pickup.day}</Text><Text style={styles.whenTime}>{pickup.time}</Text></View>
          <View style={styles.when}><Text style={styles.whenLabel}>Drop-off</Text><Text style={styles.whenValue}>{dropoff.day}</Text><Text style={styles.whenTime}>{dropoff.time}</Text></View>
          <View style={styles.when}>
            <Text style={styles.whenLabel}>Pickup Location</Text>
            <Text style={styles.whenValue} numberOfLines={2}>{place}</Text>
            <TouchableOpacity onPress={onMap} accessibilityRole="button"><Text style={styles.link}>View Map</Text></TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.rowHead}>
          <Text style={styles.section}>Booking Status</Text>
          <Text style={styles.statusPill}>{booking?.displayStatus || booking?.status || 'Saved'}</Text>
        </View>
        <View style={styles.steps}>
          {steps.map(([label, done, hint], index) => <View key={label} style={styles.step}>
            {index > 0 && <View style={[styles.line, done && styles.lineOn]} />}
            <View style={[styles.dot, done && styles.dotOn]}>{done ? <Text style={styles.dotCheck}>✓</Text> : null}</View>
            <Text style={[styles.stepLabel, done && styles.stepLabelOn]}>{label}</Text>
            <Text style={styles.stepHint}>{hint}</Text>
          </View>)}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.action} onPress={addToCalendar} accessibilityRole="button"><Text style={styles.actionText}>Add to Calendar</Text></TouchableOpacity>
          <TouchableOpacity style={styles.action} onPress={share} accessibilityRole="button"><Text style={styles.actionText}>Share Booking</Text></TouchableOpacity>
        </View>
      </View>

      <View style={styles.info}>
        <Text style={styles.infoTitle}>Important Information</Text>
        <Text style={styles.infoItem}>Bring the driving licence and government ID you used for verification at pickup.</Text>
        {deposit > 0 && <Text style={styles.infoItem}>The security deposit of {money(deposit)} is refundable after the vehicle is returned.</Text>}
        <Text style={styles.infoItem}>You can cancel this booking from My bookings while it is still requested or confirmed.</Text>
      </View>
    </ScrollView>
    <View style={styles.footer}>
      <TouchableOpacity style={styles.button} onPress={onTrips} accessibilityRole="button"><Text style={styles.buttonText}>View My Bookings  →</Text></TouchableOpacity>
      <View style={styles.tabs}>
        {[['Home', onHome], ['My Bookings', onTrips], ['Help', onHelp], ['Profile', onProfile]].map(([label, action]) => <TouchableOpacity key={label} style={styles.tab} onPress={action} accessibilityRole="button"><Text style={styles.tabText}>{label}</Text></TouchableOpacity>)}
      </View>
    </View>
    <Modal visible={receipt} animationType="slide" onRequestClose={() => setReceipt(false)}>
      <SafeAreaView style={styles.sheet}>
        <Text style={styles.sheetTitle}>Booking receipt</Text>
        <Text style={styles.sheetId}>{booking?.id}</Text>
        <Line label="Rental" value={money(pricing.rental)} />
        {Number(pricing.deliveryFee) > 0 && <Line label="Delivery fee" value={money(pricing.deliveryFee)} />}
        {Number(pricing.addonFee) > 0 && <Line label="Add-ons" value={money(pricing.addonFee)} />}
        <Line label="Convenience fee" value={money(pricing.platformFee)} />
        {deposit > 0 && <Line label="Security deposit" value={money(deposit)} />}
        <Line label="Total" value={pricing.total != null ? money(pricing.total) : '—'} strong />
        <TouchableOpacity style={styles.button} onPress={() => setReceipt(false)} accessibilityRole="button"><Text style={styles.buttonText}>Close</Text></TouchableOpacity>
      </SafeAreaView>
    </Modal>
  </View>;
}

function Line({ label, value, strong }) {
  return <View style={styles.receiptRow}><Text style={styles.receiptLabel}>{label}</Text><Text style={[styles.receiptValue, strong && styles.receiptStrong]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8FA' },
  page: { padding: 16, paddingBottom: 12 },
  top: { alignItems: 'center', marginTop: 8, marginBottom: 8 },
  check: { width: 64, height: 64, borderRadius: 32, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  checkText: { color: '#FFFFFF', fontSize: 30, fontWeight: '800' },
  close: { position: 'absolute', right: 0, top: 0, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: MUTED, fontSize: 28 },
  title: { color: INK, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  sub: { color: MUTED, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 6, marginBottom: 14 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E8ECF0', padding: 14, marginBottom: 12 },
  vehicle: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  photo: { width: 92, height: 72, borderRadius: 12, backgroundColor: '#F3F5F7', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoImage: { width: '100%', height: '100%' },
  emoji: { fontSize: 32 },
  vehicleName: { color: INK, fontSize: 16, fontWeight: '800' },
  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  spec: { color: '#3C4652', fontSize: 11, fontWeight: '700', backgroundColor: '#F4F6F8', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  idCard: { backgroundColor: '#F3FBF6', borderRadius: 18, borderWidth: 1, borderColor: '#D7F0E2', padding: 14, marginBottom: 12, flexDirection: 'row', gap: 10 },
  idLabel: { color: MUTED, fontSize: 12 },
  idValue: { color: INK, fontSize: 16, fontWeight: '800', marginTop: 2 },
  idHint: { color: MUTED, fontSize: 11, marginTop: 4 },
  idSide: { alignItems: 'flex-end' },
  paid: { color: MUTED, fontSize: 12, fontWeight: '800', backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  paidOn: { color: GREEN },
  total: { color: INK, fontSize: 18, fontWeight: '800', marginTop: 8 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  section: { color: INK, fontSize: 16, fontWeight: '800' },
  link: { color: GREEN, fontSize: 12, fontWeight: '700', marginTop: 4 },
  trip: { flexDirection: 'row', gap: 8 },
  when: { flex: 1 },
  whenLabel: { color: MUTED, fontSize: 11 },
  whenValue: { color: INK, fontSize: 12, fontWeight: '700', marginTop: 3 },
  whenTime: { color: MUTED, fontSize: 11, marginTop: 2 },
  statusPill: { color: GREEN, fontSize: 12, fontWeight: '800', backgroundColor: '#E7F8EC', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  steps: { flexDirection: 'row', marginTop: 8 },
  step: { flex: 1, alignItems: 'center' },
  line: { position: 'absolute', left: -16, right: 16, top: 10, height: 2, backgroundColor: '#E5E7EB' },
  lineOn: { backgroundColor: BUTTON },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#D5DBE1', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: BUTTON, borderColor: BUTTON },
  dotCheck: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  stepLabel: { color: MUTED, fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  stepLabelOn: { color: GREEN },
  stepHint: { color: MUTED, fontSize: 9, textAlign: 'center', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  action: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1, borderColor: '#E8ECF0', alignItems: 'center', justifyContent: 'center' },
  actionText: { color: INK, fontSize: 12, fontWeight: '700' },
  info: { backgroundColor: '#F3FBF6', borderRadius: 18, padding: 14, marginBottom: 8 },
  infoTitle: { color: GREEN, fontSize: 14, fontWeight: '800', marginBottom: 8 },
  infoItem: { color: '#3C4652', fontSize: 12, lineHeight: 18, marginBottom: 6 },
  footer: { paddingHorizontal: 16, paddingTop: 8, backgroundColor: '#F7F8FA' },
  button: { height: 54, borderRadius: 27, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  tabs: { flexDirection: 'row', marginTop: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabText: { color: GREEN, fontSize: 11, fontWeight: '700' },
  sheet: { flex: 1, backgroundColor: '#FFFFFF', padding: 22 },
  sheetTitle: { color: INK, fontSize: 22, fontWeight: '800' },
  sheetId: { color: MUTED, marginTop: 4, marginBottom: 16 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EEF1F4' },
  receiptLabel: { color: MUTED, fontSize: 14 },
  receiptValue: { color: INK, fontSize: 14, fontWeight: '700' },
  receiptStrong: { fontSize: 16, fontWeight: '800' },
});
