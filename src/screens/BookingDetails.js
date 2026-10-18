import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { rideOnApi } from '../services/api';

const INK = '#12161C';
const MUTED = '#6B7280';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const LINE = '#E6E8EC';
const REASONS = ['Change in travel plans', 'Found another option', 'Personal reasons', 'Weather conditions', 'Other'];
const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const parsed = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};
const stamp = (value) => parsed(value)?.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '';
const dayPart = (iso) => (iso || '').slice(0, 10);
const timePart = (iso) => {
  const date = parsed(iso);
  if (!date) return '10:00';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const showTime = (value) => {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return value || '';
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${match[2]} ${suffix}`;
};
const kindOf = (vehicle, booking) => {
  const type = String(vehicle?.type || booking?.vehicleType || '').toLowerCase();
  const fleetClass = String(vehicle?.fleetVehicleClass || '').toLowerCase();
  if (type === 'car') return 'Car';
  if (fleetClass === 'scooter' || type === 'scooter') return 'Scooter';
  if (type === 'bike') return 'Bike';
  return '';
};
const imageOf = (vehicle, booking) => [...(vehicle?.images || []), ...(booking?.images || [])].find(value => typeof value === 'string' && /^https?:\/\//i.test(value));

function Back({ onPress }) {
  return <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backMark}>‹</Text></TouchableOpacity>;
}

function VehicleCard({ booking, vehicle, status }) {
  const image = imageOf(vehicle, booking);
  const specs = [kindOf(vehicle, booking), vehicle?.fuel, vehicle?.transmission].filter(Boolean).join(' • ');
  const plate = vehicle?.registrationNumber || '';
  return (
    <View style={styles.vehicle}>
      <View style={styles.photo}>{image ? <Image source={{ uri: image }} style={styles.photoImage} /> : <Text style={styles.photoFallback}>{kindOf(vehicle, booking) === 'Car' ? '🚘' : '🛵'}</Text>}</View>
      <View style={styles.copy}>
        <Text style={styles.vehicleName}>{booking?.vehicle || vehicle?.name || 'RideOn vehicle'}</Text>
        {!!specs && <Text style={styles.meta}>{specs}</Text>}
        {!!plate && <Text style={styles.meta}>{plate}</Text>}
      </View>
      {!!status && <View style={styles.status}><Text style={styles.statusText}>✓ {status}</Text></View>}
    </View>
  );
}

export default function BookingDetails({ booking, vehicle, start = 'details', onBack, onUpdated, onBookings, onHome, onSupport }) {
  const [view, setView] = useState(start);
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [pickupDate, setPickupDate] = useState(dayPart(booking?.pickupAt));
  const [pickupTime, setPickupTime] = useState(timePart(booking?.pickupAt));
  const [returnDate, setReturnDate] = useState(dayPart(booking?.returnAt));
  const [returnTime, setReturnTime] = useState(timePart(booking?.returnAt));
  const [place, setPlace] = useState(booking?.address || '');
  const [result, setResult] = useState(null);
  const [invoice, setInvoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pricing = result?.booking?.pricing || booking?.pricing || {};
  const current = result?.booking ? { ...booking, ...result.booking, pickupAt: result.booking.startAt || result.booking.pickupAt, returnAt: result.booking.endAt || result.booking.returnAt } : booking;
  const status = String(current?.status || '').toLowerCase();
  const canChange = status === 'requested' || status === 'confirmed';
  const days = Number(pricing.days || 0) || Math.max(1, Math.ceil(((parsed(current?.returnAt) - parsed(current?.pickupAt)) || 0) / 86400000));

  useEffect(() => {
    setView(start);
    if (start !== 'cancel' || !booking?.id) return undefined;
    let active = true;
    setBusy(true);
    rideOnApi.getCancellationPreview(booking.id).then((response) => {
      if (active) setPreview(response?.cancellation || null);
    }).catch((e) => {
      if (active) setError(e?.message || 'This booking can no longer be cancelled.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [start, booking?.id]);

  const loadPreview = async () => {
    if (!booking?.id) return;
    setBusy(true);
    setError('');
    try {
      const response = await rideOnApi.getCancellationPreview(booking.id);
      setPreview(response?.cancellation || null);
      setView('cancel');
    } catch (e) {
      setError(e?.message || 'This booking can no longer be cancelled.');
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await rideOnApi.cancelBooking(booking.id, { reason });
      const next = response?.booking || response?.data;
      setResult(response);
      setPreview(response?.cancellation || preview);
      onUpdated?.(next);
      setView('cancelled');
    } catch (e) {
      setError(e?.message || 'The booking could not be cancelled.');
    } finally { setBusy(false); }
  };

  const reschedule = async () => {
    const startAt = new Date(`${pickupDate}T${pickupTime}:00`);
    const endAt = new Date(`${returnDate}T${returnTime}:00`);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) return setError('Choose a return time after pickup.');
    setBusy(true);
    setError('');
    try {
      const response = await rideOnApi.rescheduleBooking(booking.id, { startAt: startAt.toISOString(), endAt: endAt.toISOString(), address: place });
      setResult(response);
      onUpdated?.(response?.booking);
      setView('rescheduled');
    } catch (e) {
      const previous = e?.details?.previousTotal;
      const next = e?.details?.newTotal;
      setError(e?.code === 'RESCHEDULE_PRICE_CHANGED' && previous != null && next != null ? `Those dates change the paid amount from ${money(previous)} to ${money(next)}.` : (e?.message || 'The booking could not be rescheduled.'));
    } finally { setBusy(false); }
  };

  const openMap = () => {
    const query = current?.address || place;
    if (!query) return setError('This booking has no location to open.');
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`);
  };

  const shareInvoice = () => {
    const lines = [
      `RideOn booking ${current?.id}`,
      current?.vehicle,
      stamp(current?.pickupAt),
      stamp(current?.returnAt),
      `Rental ${money(pricing.rental)}`,
      `Delivery ${money(pricing.deliveryFee)}`,
      `Platform fee ${money(pricing.platformFee)}`,
      `Security deposit ${money(pricing.securityDeposit)}`,
      `Total ${money(pricing.total)}`,
    ].filter(Boolean);
    Share.share({ message: lines.join('\n') });
  };

  const policy = preview?.policy;
  const refund = result?.refund;
  const refundNote = !preview?.paid && view !== 'cancelled'
    ? 'This booking is not paid, so cancelling it does not create a refund.'
    : refund?.status === 'refund_pending' || current?.paymentStatus === 'refund_pending'
      ? 'The refund is pending with the payment provider.'
      : preview?.paid && Number(preview?.totalRefund || result?.cancellation?.totalRefund || 0) === 0
        ? 'No refund is due for this cancellation.'
        : 'The refund amount is the amount RideOn calculated for this cancellation.';

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {view === 'details' && <>
          <View style={styles.header}><Back onPress={onBack} /><TouchableOpacity onPress={onSupport} accessibilityRole="button"><Text style={styles.more}>•••</Text></TouchableOpacity></View>
          <Text style={styles.title}>Booking Details</Text>
          <Text style={styles.subtitle}>View your booking information.</Text>
          <VehicleCard booking={current} vehicle={vehicle} status={status === 'confirmed' ? 'Confirmed' : status === 'requested' ? 'Requested' : status === 'cancelled' ? 'Cancelled' : current?.status} />
          <View style={styles.split}>
            <View style={styles.splitItem}><Text style={styles.kicker}>Booking ID</Text><TouchableOpacity onPress={() => Share.share({ message: String(current?.id || '') })}><Text style={styles.strong}>{current?.id}</Text></TouchableOpacity></View>
            <View style={styles.splitItem}><Text style={styles.kicker}>Booking Date</Text><Text style={styles.strong}>{stamp(current?.createdAt) || '—'}</Text></View>
          </View>
          <View style={styles.card}>
            <Text style={styles.rowTitle}>Pickup {parsed(current?.pickupAt) > new Date() ? '· Upcoming' : ''}</Text>
            <Text style={styles.body}>{stamp(current?.pickupAt)}</Text>
            <Text style={styles.meta}>{current?.address || 'Pickup location is on the booking'}</Text>
            <Text style={[styles.rowTitle, { marginTop: 14 }]}>Return</Text>
            <Text style={styles.body}>{stamp(current?.returnAt)}</Text>
            <Text style={styles.meta}>{current?.returnLocation || 'Pickup and return use this location'}</Text>
            <TouchableOpacity onPress={openMap} accessibilityRole="button"><Text style={styles.link}>View on Map</Text></TouchableOpacity>
          </View>
          <View style={styles.card}>
            <Text style={styles.section}>Price Details</Text>
            <PriceLine label={`Rental${days ? ` (${days} day${days === 1 ? '' : 's'})` : ''}`} value={money(pricing.rental)} />
            <PriceLine label="Security Deposit" value={money(pricing.securityDeposit)} />
            <PriceLine label="Delivery Fee" value={money(pricing.deliveryFee)} />
            {Number(pricing.platformFee) > 0 && <PriceLine label="Platform fee" value={money(pricing.platformFee)} />}
            {Number(pricing.addonFee) > 0 && <PriceLine label="Add-ons" value={money(pricing.addonFee)} />}
            <PriceLine label="Total Amount" value={money(pricing.total)} bold />
          </View>
          {canChange && <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={loadPreview} disabled={busy} accessibilityRole="button"><Text style={styles.cancelText}>{busy ? 'Checking…' : 'Cancel Booking'}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.rescheduleBtn} onPress={() => { setError(''); setView('reschedule'); }} accessibilityRole="button"><Text style={styles.rescheduleText}>Reschedule</Text></TouchableOpacity>
          </View>}
          <TouchableOpacity style={styles.button} onPress={() => setInvoice(true)} accessibilityRole="button"><Text style={styles.buttonText}>View Invoice</Text></TouchableOpacity>
        </>}
        {view === 'cancel' && <>
          <Back onPress={() => setView('details')} />
          <Text style={styles.title}>Cancel Booking</Text>
          <Text style={styles.subtitle}>Please tell us the reason for cancellation.</Text>
          <VehicleCard booking={current} vehicle={vehicle} status={status === 'confirmed' ? 'Confirmed' : current?.status} />
          <Text style={styles.section}>Reason for Cancellation</Text>
          {REASONS.map(item => <TouchableOpacity key={item} style={[styles.reason, reason === item && styles.reasonOn]} onPress={() => setReason(item)} accessibilityRole="button"><Text style={styles.reasonMark}>{reason === item ? '●' : '○'}</Text><Text style={styles.reasonText}>{item}</Text></TouchableOpacity>)}
          <View style={styles.card}>
            <Text style={styles.section}>Refund Information</Text>
            <PriceLine label="Refundable rental" value={money(preview?.refundableRental)} />
            <PriceLine label="Delivery Fee" value={money(preview?.refundableDelivery)} />
            {Number(preview?.refundableSecurityDeposit) > 0 && <PriceLine label="Security deposit" value={money(preview?.refundableSecurityDeposit)} />}
            {Number(preview?.cancellationFee) > 0 && <PriceLine label="Cancellation fee" value={money(preview?.cancellationFee)} />}
            <PriceLine label="Total Refund Amount" value={money(preview?.totalRefund)} bold />
          </View>
          {!!policy && <View style={styles.notice}><Text style={styles.noticeText}>{Number(policy.feePercent) > 0 ? `A ${policy.feePercent}% rental fee applies when a paid booking is cancelled inside ${policy.cutoffHours} hours of pickup. Before that, the paid rental is refundable.` : `Paid rental charges are refundable. The cancellation window is ${policy.cutoffHours} hours before pickup.`}</Text></View>}
          <TouchableOpacity style={styles.danger} disabled={busy} onPress={cancel} accessibilityRole="button">{busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Cancel Booking</Text>}</TouchableOpacity>
        </>}
        {view === 'cancelled' && <>
          <Back onPress={onBack} />
          <View style={styles.success}><Text style={styles.tick}>✓</Text></View>
          <Text style={[styles.title, styles.center]}>Booking Cancelled</Text>
          <Text style={[styles.subtitle, styles.center]}>Your booking has been cancelled.</Text>
          <VehicleCard booking={current} vehicle={vehicle} />
          <View style={styles.card}><Text style={styles.kicker}>Cancellation Reason</Text><Text style={styles.strong}>{reason}</Text><Text style={styles.meta}>Cancelled {stamp(current?.cancelledAt) || 'just now'}</Text></View>
          <View style={styles.card}>
            <Text style={styles.section}>Refund Information</Text>
            <PriceLine label="Total Refund Amount" value={money(result?.cancellation?.totalRefund ?? preview?.totalRefund)} bold />
            <Text style={styles.meta}>{refundNote}</Text>
          </View>
          <TouchableOpacity style={styles.button} onPress={onBookings} accessibilityRole="button"><Text style={styles.buttonText}>View Bookings</Text></TouchableOpacity>
        </>}
        {view === 'reschedule' && <>
          <Back onPress={() => setView('details')} />
          <Text style={styles.title}>Reschedule Booking</Text>
          <Text style={styles.subtitle}>Select a new pickup and return time.</Text>
          <VehicleCard booking={current} vehicle={vehicle} status={status === 'confirmed' ? 'Confirmed' : current?.status} />
          <View style={styles.card}>
            <Text style={styles.section}>Current Booking</Text>
            <Text style={styles.body}>Pickup {stamp(booking?.pickupAt)}</Text>
            <Text style={styles.body}>Return {stamp(booking?.returnAt)}</Text>
            <Text style={styles.meta}>{booking?.address}</Text>
          </View>
          <Text style={styles.label}>Pickup date</Text>
          <TextInput value={pickupDate} onChangeText={setPickupDate} placeholder="YYYY-MM-DD" placeholderTextColor="#A0A7B1" style={styles.input} />
          <Text style={styles.label}>Pickup time</Text>
          <TextInput value={pickupTime} onChangeText={setPickupTime} placeholder="HH:mm" placeholderTextColor="#A0A7B1" style={styles.input} />
          <Text style={styles.hint}>{showTime(pickupTime)}</Text>
          <Text style={styles.label}>Return date</Text>
          <TextInput value={returnDate} onChangeText={setReturnDate} placeholder="YYYY-MM-DD" placeholderTextColor="#A0A7B1" style={styles.input} />
          <Text style={styles.label}>Return time</Text>
          <TextInput value={returnTime} onChangeText={setReturnTime} placeholder="HH:mm" placeholderTextColor="#A0A7B1" style={styles.input} />
          <Text style={styles.hint}>{showTime(returnTime)}</Text>
          <Text style={styles.label}>Pickup location</Text>
          <TextInput value={place} onChangeText={setPlace} placeholder="Pickup location" placeholderTextColor="#A0A7B1" style={styles.input} />
          <TouchableOpacity style={styles.button} disabled={busy} onPress={reschedule} accessibilityRole="button">{busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Continue</Text>}</TouchableOpacity>
        </>}
        {view === 'rescheduled' && <>
          <Back onPress={() => setView('details')} />
          <View style={styles.success}><Text style={styles.tick}>✓</Text></View>
          <Text style={[styles.title, styles.center]}>Booking Rescheduled</Text>
          <Text style={[styles.subtitle, styles.center]}>Your booking has been rescheduled.</Text>
          <VehicleCard booking={current} vehicle={vehicle} status={status === 'confirmed' ? 'Confirmed' : current?.status} />
          <View style={styles.card}>
            <Text style={styles.section}>Updated Booking Details</Text>
            <Text style={styles.body}>Pickup {stamp(current?.pickupAt)}</Text>
            <Text style={styles.meta}>{current?.address}</Text>
            <Text style={styles.body}>Return {stamp(current?.returnAt)}</Text>
          </View>
          <View style={styles.card}>
            <PriceLine label="Previous total" value={money(result?.previousTotal)} />
            <PriceLine label="New total" value={money(result?.newTotal)} />
            <PriceLine label="Amount difference" value={money(Number(result?.newTotal || 0) - Number(result?.previousTotal || 0))} />
            {Number(result?.newTotal) === Number(result?.previousTotal) && <Text style={styles.meta}>The total is unchanged.</Text>}
          </View>
          <TouchableOpacity style={styles.button} onPress={() => setView('details')} accessibilityRole="button"><Text style={styles.buttonText}>View Booking Details</Text></TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={onHome} accessibilityRole="button"><Text style={styles.secondaryText}>Go to Home</Text></TouchableOpacity>
        </>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <Modal visible={invoice} transparent animationType="slide" onRequestClose={() => setInvoice(false)}>
        <View style={styles.modal}><View style={styles.sheet}>
          <Text style={styles.section}>Invoice</Text>
          <PriceLine label="Rental" value={money(pricing.rental)} />
          <PriceLine label="Delivery" value={money(pricing.deliveryFee)} />
          <PriceLine label="Platform fee" value={money(pricing.platformFee)} />
          <PriceLine label="Security deposit" value={money(pricing.securityDeposit)} />
          {Number(pricing.addonFee) > 0 && <PriceLine label="Add-ons" value={money(pricing.addonFee)} />}
          <PriceLine label="Total" value={money(pricing.total)} bold />
          <TouchableOpacity style={styles.button} onPress={shareInvoice} accessibilityRole="button"><Text style={styles.buttonText}>Share invoice</Text></TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => setInvoice(false)} accessibilityRole="button"><Text style={styles.secondaryText}>Close</Text></TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}

function PriceLine({ label, value, bold }) {
  return <View style={styles.priceRow}><Text style={[styles.priceLabel, bold && styles.priceBold]}>{label}</Text><Text style={[styles.priceValue, bold && styles.priceBold]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#FFFFFF'},
  page:{padding:22,paddingBottom:40},
  header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  back:{width:36,height:36,justifyContent:'center'},
  backMark:{fontSize:32,color:INK,lineHeight:34},
  more:{fontSize:18,color:INK,fontWeight:'800'},
  title:{fontSize:30,fontWeight:'800',color:INK,letterSpacing:-0.4},
  subtitle:{fontSize:15,color:MUTED,marginTop:4,marginBottom:16},
  center:{textAlign:'center'},
  vehicle:{flexDirection:'row',gap:12,alignItems:'center',borderWidth:1,borderColor:LINE,borderRadius:16,padding:12,marginBottom:12},
  photo:{width:72,height:56,borderRadius:10,backgroundColor:'#F4F6F8',alignItems:'center',justifyContent:'center',overflow:'hidden'},
  photoImage:{width:72,height:56},
  photoFallback:{fontSize:24},
  copy:{flex:1},
  vehicleName:{fontSize:16,fontWeight:'800',color:INK},
  meta:{fontSize:13,color:MUTED,marginTop:2},
  status:{backgroundColor:'#E5F8EE',borderRadius:12,paddingHorizontal:8,paddingVertical:4},
  statusText:{color:GREEN,fontWeight:'800',fontSize:12},
  split:{flexDirection:'row',gap:10,marginBottom:12},
  splitItem:{flex:1,backgroundColor:'#F7F8FA',borderRadius:14,padding:12},
  kicker:{fontSize:12,color:MUTED},
  strong:{fontSize:14,fontWeight:'800',color:INK,marginTop:4},
  card:{borderWidth:1,borderColor:LINE,borderRadius:16,padding:14,marginBottom:12},
  rowTitle:{fontSize:15,fontWeight:'800',color:INK},
  body:{fontSize:14,color:INK,marginTop:4},
  link:{color:GREEN,fontWeight:'800',marginTop:10},
  section:{fontSize:16,fontWeight:'800',color:INK,marginBottom:8},
  priceRow:{flexDirection:'row',justifyContent:'space-between',paddingVertical:4},
  priceLabel:{color:MUTED,fontSize:14},
  priceValue:{color:INK,fontSize:14,fontWeight:'700'},
  priceBold:{color:INK,fontWeight:'800',fontSize:16},
  actions:{flexDirection:'row',gap:10,marginBottom:10},
  cancelBtn:{flex:1,height:48,borderRadius:12,backgroundColor:'#FDECEC',alignItems:'center',justifyContent:'center'},
  cancelText:{color:'#D92D20',fontWeight:'800'},
  rescheduleBtn:{flex:1,height:48,borderRadius:12,backgroundColor:'#E7F6EF',alignItems:'center',justifyContent:'center'},
  rescheduleText:{color:GREEN,fontWeight:'800'},
  button:{height:54,borderRadius:14,backgroundColor:BUTTON,alignItems:'center',justifyContent:'center',marginTop:8},
  buttonText:{color:'#FFFFFF',fontSize:16,fontWeight:'800'},
  danger:{height:54,borderRadius:14,backgroundColor:'#E5484D',alignItems:'center',justifyContent:'center',marginTop:8},
  secondary:{height:52,borderRadius:14,backgroundColor:'#F3F4F6',alignItems:'center',justifyContent:'center',marginTop:10},
  secondaryText:{color:INK,fontWeight:'800'},
  reason:{flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:LINE,borderRadius:14,padding:14,marginBottom:8},
  reasonOn:{backgroundColor:'#F3FBF7',borderColor:'#BFE8D4'},
  reasonMark:{color:GREEN,fontSize:16},
  reasonText:{fontSize:15,color:INK,fontWeight:'600'},
  notice:{backgroundColor:'#FFF8EB',borderRadius:14,padding:12,marginBottom:8},
  noticeText:{color:'#8A5A00',lineHeight:20},
  label:{fontSize:13,fontWeight:'700',color:INK,marginTop:8,marginBottom:6},
  input:{height:50,borderWidth:1,borderColor:LINE,borderRadius:12,paddingHorizontal:12,color:INK,fontSize:16},
  hint:{color:MUTED,marginTop:4},
  success:{width:84,height:84,borderRadius:42,backgroundColor:'#E5F8EE',alignSelf:'center',alignItems:'center',justifyContent:'center',marginVertical:12},
  tick:{fontSize:36,color:GREEN,fontWeight:'800'},
  error:{color:'#B42318',fontWeight:'700',marginTop:12,lineHeight:18},
  modal:{flex:1,backgroundColor:'rgba(17,24,39,0.35)',justifyContent:'flex-end'},
  sheet:{backgroundColor:'#FFFFFF',borderTopLeftRadius:20,borderTopRightRadius:20,padding:18,paddingBottom:28},
});
