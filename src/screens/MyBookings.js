import React, { useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const INK = '#12161C';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const MUTED = '#6B7280';
const TABS = ['Upcoming', 'Completed', 'Cancelled'];
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const when = value => {
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
const groupOf = trip => trip?.category === 'Cancelled' ? 'Cancelled' : trip?.category === 'Completed' ? 'Completed' : 'Upcoming';
const imageOf = trip => trip?.images?.find(value => typeof value === 'string' && /^https?:\/\//i.test(value));

export default function MyBookings({ trips, vehicles, filter, onFilter, loading, error, signedIn, onSignIn, onRefresh, onOpen, onTrack, onSupport, onMap, onPay, onCancel }) {
  const [menu, setMenu] = useState(null);
  const selected = filter === 'Completed' || filter === 'Cancelled' ? filter : 'Upcoming';
  const counts = Object.fromEntries(TABS.map(tab => [tab, trips.filter(trip => groupOf(trip) === tab).length]));
  const visible = trips.filter(trip => groupOf(trip) === selected);

  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>My Bookings</Text>
          <Text style={styles.sub}>View and manage your bookings</Text>
        </View>
        <TouchableOpacity onPress={onRefresh} accessibilityRole="button" accessibilityLabel="Refresh bookings"><Text style={styles.refresh}>↻</Text></TouchableOpacity>
      </View>
      <View style={styles.tabs}>
        {TABS.map(tab => <TouchableOpacity key={tab} style={[styles.tab, selected === tab && styles.tabOn]} onPress={() => onFilter(tab)} accessibilityRole="tab" accessibilityState={{ selected: selected === tab }}>
          <Text style={[styles.tabText, selected === tab && styles.tabTextOn]}>{tab}</Text>
          <View style={[styles.count, selected === tab && styles.countOn]}><Text style={[styles.countText, selected === tab && styles.countTextOn]}>{counts[tab]}</Text></View>
        </TouchableOpacity>)}
      </View>
      {!signedIn && <View style={styles.empty}><Text style={styles.emptyTitle}>Sign in to see your bookings</Text><TouchableOpacity style={styles.details} onPress={onSignIn} accessibilityRole="button"><Text style={styles.detailsText}>Sign in</Text></TouchableOpacity></View>}
      {signedIn && loading && !visible.length && <ActivityIndicator color={BUTTON} style={{ marginTop: 24 }} />}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {signedIn && !loading && !visible.length && !error && <View style={styles.empty}><Text style={styles.emptyTitle}>No {selected.toLowerCase()} bookings</Text><Text style={styles.emptyBody}>Bookings you request will show up here.</Text></View>}
      {visible.map(trip => {
        const fleet = vehicles.find(item => String(item.id) === String(trip.vehicleId));
        const image = imageOf(trip) || fleet?.images?.[0];
        const specs = [fleet?.fuel, fleet?.transmission].filter(Boolean);
        const paid = ['paid', 'held', 'settlement_pending', 'settled'].includes(String(trip.paymentStatus || '').toLowerCase());
        const confirmed = ['confirmed', 'in_progress', 'completed'].includes(String(trip.status || '').toLowerCase());
        const ongoing = trip.category === 'Active' || String(trip.status || '').toLowerCase() === 'in_progress';
        const live = ['in_delivery', 'delivery_started'].includes(String(trip.deliveryStatus || '').toLowerCase()) || ['DELIVERY_STARTED', 'IN_DELIVERY', 'PICKUP_STARTED'].includes(String(trip.lifecycleState || '').toUpperCase());
        const pickup = when(trip.pickupAt);
        const dropoff = when(trip.returnAt);
        const place = trip.address || 'Pickup location on the booking';
        const deposit = Number(trip.pricing?.securityDeposit || 0);
        const steps = [
          ['Booking Confirmed', confirmed, stamp(trip.createdAt)],
          ['Payment Successful', paid, paid ? 'Verified' : 'Pending'],
          ['Vehicle Preparing', confirmed, ongoing ? 'On the way' : 'Before pickup'],
          ['Ongoing Trip', ongoing, ongoing ? 'In progress' : ''],
        ];
        const badge = trip.category === 'Active' ? 'Active' : groupOf(trip);
        return <View key={trip.id} style={styles.card}>
          <View style={styles.vehicle}>
            <View style={styles.photo}>{image ? <Image source={{ uri: image }} style={styles.photoImage} resizeMode="cover" /> : <Text style={styles.emoji}>🛵</Text>}</View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{trip.vehicle || 'RideOn vehicle'}</Text>
              <View style={styles.specs}>{specs.map(spec => <Text key={spec} style={styles.spec}>{spec}</Text>)}{!!trip.vehicleType && <Text style={styles.spec}>{trip.vehicleType}</Text>}</View>
            </View>
            <Text style={styles.badge}>{badge}</Text>
          </View>
          <View style={styles.track}>
            {steps.map(([label, done, hint], index) => <View key={label} style={styles.step}>
              {index > 0 && <View style={[styles.line, done && styles.lineOn]} />}
              <View style={[styles.dot, done && styles.dotOn, index === 2 && confirmed && !ongoing && styles.dotNow]}>{done && !(index === 2 && confirmed && !ongoing) ? <Text style={styles.dotCheck}>✓</Text> : null}</View>
              <Text style={[styles.stepLabel, done && styles.stepLabelOn]}>{label}</Text>
              {!!hint && <Text style={styles.stepHint}>{hint}</Text>}
            </View>)}
          </View>
          <View style={styles.whenRow}>
            <View style={styles.when}><Text style={styles.whenLabel}>Pickup</Text><Text style={styles.whenValue}>{pickup.day}</Text><Text style={styles.whenTime}>{pickup.time}</Text></View>
            <View style={styles.when}><Text style={styles.whenLabel}>Drop-off</Text><Text style={styles.whenValue}>{dropoff.day}</Text><Text style={styles.whenTime}>{dropoff.time}</Text></View>
            <TouchableOpacity style={styles.when} onPress={() => onMap(trip)} accessibilityRole="button">
              <Text style={styles.whenLabel}>Pickup Location</Text>
              <Text style={styles.whenValue} numberOfLines={2}>{place}</Text>
              <Text style={styles.link}>View Map</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.details} onPress={() => onOpen(trip)} accessibilityRole="button"><Text style={styles.detailsText}>View Details</Text></TouchableOpacity>
            <TouchableOpacity style={styles.ghost} onPress={() => openDirections(place)} accessibilityRole="button"><Text style={styles.ghostText}>Get Directions</Text></TouchableOpacity>
            <TouchableOpacity style={styles.ghost} onPress={() => onSupport(trip)} accessibilityRole="button"><Text style={styles.ghostText}>Contact Support</Text></TouchableOpacity>
            <TouchableOpacity style={styles.more} onPress={() => setMenu(trip)} accessibilityRole="button" accessibilityLabel="More booking actions"><Text style={styles.moreText}>···</Text></TouchableOpacity>
          </View>
          {selected === 'Upcoming' && <View style={styles.info}>
            <Text style={styles.infoTitle}>Important for Pickup</Text>
            <Text style={styles.infoItem}>Carry a valid driving licence and government ID.</Text>
            {deposit > 0 && <Text style={styles.infoItem}>Security deposit of {money(deposit)} is held with this booking and is refundable after the vehicle is returned.</Text>}
            <Text style={styles.infoItem}>Arrive at the pickup time shown on this booking.</Text>
          </View>}
          {selected === 'Upcoming' && trip.delivery && <View style={styles.live}>
            <View style={{ flex: 1 }}>
              <Text style={styles.liveTitle}>Track Your Delivery</Text>
              <Text style={styles.liveBody}>{live ? 'Delivery is on the way. Open live tracking for this booking.' : 'Live tracking appears when the vehicle is on the way.'}</Text>
            </View>
            <TouchableOpacity style={styles.trackButton} onPress={() => live ? (onTrack || onOpen)(trip) : onMap(trip)} accessibilityRole="button"><Text style={styles.trackText}>{live ? 'Track Live  →' : 'View Map'}</Text></TouchableOpacity>
          </View>}
          {selected === 'Upcoming' && ['requested', 'confirmed'].includes(String(trip.status || '').toLowerCase()) && <TouchableOpacity style={styles.change} onPress={() => onOpen(trip)} accessibilityRole="button">
            <View style={{ flex: 1 }}><Text style={styles.liveTitle}>Need to Make Changes?</Text><Text style={styles.liveBody}>Open this booking to review it or cancel it.</Text></View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>}
        </View>;
      })}
    </ScrollView>
    <Modal visible={!!menu} transparent animationType="fade" onRequestClose={() => setMenu(null)}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setMenu(null)}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{menu?.vehicle || 'Booking'}</Text>
          <SheetAction label="View details" onPress={() => { const trip = menu; setMenu(null); onOpen(trip); }} />
          <SheetAction label="Get directions" onPress={() => { openDirections(menu?.address || ''); setMenu(null); }} />
          <SheetAction label="Contact support" onPress={() => { const trip = menu; setMenu(null); onSupport(trip); }} />
          {menu && !['paid', 'held', 'settlement_pending', 'settled', 'refunded'].includes(String(menu.paymentStatus || '').toLowerCase()) && !['cancelled', 'rejected', 'completed'].includes(String(menu.status || '').toLowerCase()) && <SheetAction label="Pay now" onPress={() => { const trip = menu; setMenu(null); onPay(trip); }} />}
          {menu && ['requested', 'confirmed'].includes(String(menu.status || '').toLowerCase()) && <SheetAction label="Cancel booking" onPress={() => { const trip = menu; setMenu(null); onCancel(trip); }} />}
        </View>
      </TouchableOpacity>
    </Modal>
  </View>;
}

function openDirections(place) {
  const query = String(place || '').trim();
  if (!query || query === 'Pickup location on the booking') return;
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`).catch(() => {});
}
function SheetAction({ label, onPress }) {
  return <TouchableOpacity style={styles.sheetAction} onPress={onPress} accessibilityRole="button"><Text style={styles.sheetActionText}>{label}</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8FA' },
  page: { padding: 16, paddingBottom: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: INK, fontSize: 26, fontWeight: '800' },
  sub: { color: MUTED, fontSize: 13, marginTop: 2 },
  refresh: { color: GREEN, fontSize: 22, fontWeight: '800' },
  tabs: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 4, marginTop: 14, marginBottom: 12 },
  tab: { flex: 1, height: 38, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tabOn: { backgroundColor: '#E7F8EC' },
  tabText: { color: MUTED, fontSize: 12, fontWeight: '700' },
  tabTextOn: { color: GREEN },
  count: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#EEF1F4', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countOn: { backgroundColor: BUTTON },
  countText: { color: MUTED, fontSize: 10, fontWeight: '800' },
  countTextOn: { color: '#FFFFFF' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E8ECF0', padding: 14, marginBottom: 12 },
  vehicle: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  photo: { width: 92, height: 72, borderRadius: 12, backgroundColor: '#F3F5F7', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoImage: { width: '100%', height: '100%' },
  emoji: { fontSize: 28 },
  name: { color: INK, fontSize: 16, fontWeight: '800' },
  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  spec: { color: '#3C4652', fontSize: 11, fontWeight: '700', backgroundColor: '#F4F6F8', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  badge: { color: GREEN, fontSize: 11, fontWeight: '800' },
  track: { flexDirection: 'row', backgroundColor: '#F3FBF6', borderRadius: 14, padding: 10, marginTop: 12 },
  step: { flex: 1, alignItems: 'center' },
  line: { position: 'absolute', left: -12, right: 12, top: 9, height: 2, backgroundColor: '#E5E7EB' },
  lineOn: { backgroundColor: BUTTON },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D5DBE1', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: BUTTON, borderColor: BUTTON },
  dotNow: { backgroundColor: '#FFFFFF', borderColor: BUTTON },
  dotCheck: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  stepLabel: { color: MUTED, fontSize: 9, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  stepLabelOn: { color: GREEN },
  stepHint: { color: MUTED, fontSize: 8, textAlign: 'center', marginTop: 2 },
  whenRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  when: { flex: 1 },
  whenLabel: { color: MUTED, fontSize: 11 },
  whenValue: { color: INK, fontSize: 12, fontWeight: '700', marginTop: 3 },
  whenTime: { color: MUTED, fontSize: 11, marginTop: 2 },
  link: { color: GREEN, fontSize: 12, fontWeight: '700', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 6, marginTop: 12, alignItems: 'center' },
  details: { backgroundColor: BUTTON, borderRadius: 12, paddingHorizontal: 12, height: 40, alignItems: 'center', justifyContent: 'center' },
  detailsText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  ghost: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1, borderColor: '#E8ECF0', alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: INK, fontSize: 11, fontWeight: '700' },
  more: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: '#E8ECF0', alignItems: 'center', justifyContent: 'center' },
  moreText: { color: INK, fontSize: 16, fontWeight: '800' },
  info: { backgroundColor: '#F3FBF6', borderRadius: 14, padding: 12, marginTop: 12 },
  infoTitle: { color: GREEN, fontSize: 14, fontWeight: '800', marginBottom: 6 },
  infoItem: { color: '#3C4652', fontSize: 12, lineHeight: 18, marginBottom: 4 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#E8ECF0', borderRadius: 14, padding: 12, marginTop: 12 },
  liveTitle: { color: INK, fontSize: 14, fontWeight: '800' },
  liveBody: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 3 },
  trackButton: { borderWidth: 1, borderColor: '#8ED9B4', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  trackText: { color: GREEN, fontSize: 12, fontWeight: '800' },
  change: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E8ECF0', borderRadius: 14, padding: 12, marginTop: 12 },
  chevron: { color: MUTED, fontSize: 22 },
  empty: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, marginTop: 8 },
  emptyTitle: { color: INK, fontSize: 16, fontWeight: '800' },
  emptyBody: { color: MUTED, fontSize: 13, marginTop: 4 },
  error: { color: '#B23B3B', fontWeight: '700', marginBottom: 8 },
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 28 },
  sheetTitle: { color: INK, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  sheetAction: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#EEF1F4' },
  sheetActionText: { color: INK, fontSize: 15, fontWeight: '700' },
});
