import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { rideOnApi } from '../services/api';

const INK = '#12161C';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const MUTED = '#6B7280';
const SLOTS = [
  ['front', 'Front View'],
  ['left', 'Left Side'],
  ['right', 'Right Side'],
  ['rear', 'Rear View'],
  ['odometer', 'Odometer'],
];
const CONDITIONS = [
  ['none', 'no_damage', 'No Damages', 'Vehicle is in good condition'],
  ['minor', 'new_damage', 'Minor Damages', 'Small scratches or dents'],
  ['major', 'damage_review', 'Major Damages', 'Significant damage'],
];

const imageOf = vehicle => [...(Array.isArray(vehicle?.images) ? vehicle.images : []), vehicle?.imageUrl].find(value => typeof value === 'string' && /^https?:\/\//i.test(value));
const slotOf = item => item?.metadata?.slot || '';
const nearDropoff = (here, dropoff) => {
  if (!here || !dropoff) return false;
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(dropoff.latitude - here.latitude);
  const dLon = toRad(dropoff.longitude - here.longitude);
  const lat1 = toRad(here.latitude);
  const lat2 = toRad(dropoff.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h)) <= 0.3;
};

async function fileBase64(asset) {
  if (asset?.base64) return asset.base64;
  const response = await fetch(asset.uri);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default function ReturnVehicle({ booking, vehicle, onBack, onUpdated, onDone }) {
  const [evidence, setEvidence] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [condition, setCondition] = useState('none');
  const [notes, setNotes] = useState('');
  const [guide, setGuide] = useState(false);
  const [ready, setReady] = useState(false);
  const [here, setHere] = useState(null);
  const hydrated = useRef(false);
  const place = booking?.returnLocation || booking?.address || '';
  const dropoff = booking?.deliveryLatitude != null && booking?.deliveryLongitude != null ? { latitude: Number(booking.deliveryLatitude), longitude: Number(booking.deliveryLongitude) } : null;
  const returnAt = booking?.returnAt ? new Date(booking.returnAt) : null;
  const returnDay = returnAt && !Number.isNaN(returnAt.getTime()) ? returnAt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const returnTime = returnAt && !Number.isNaN(returnAt.getTime()) ? returnAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';
  const image = imageOf(vehicle) || imageOf(booking);
  const helmets = Number(String(booking?.raw?.notes || booking?.notes || '').match(/(\d+)\s+extra helmet/i)?.[1] || 0);
  const specs = [vehicle?.fuel, vehicle?.transmission, vehicle?.registrationNumber, helmets > 0 ? `${helmets} extra helmet${helmets === 1 ? '' : 's'}` : ''].filter(Boolean);
  const lifecycle = String(booking?.lifecycleState || '').toUpperCase();
  const returnOpen = ready || ['RETURN_REQUESTED', 'PICKUP_STARTED', 'RETURNED', 'COMPLETED'].includes(lifecycle);
  const settled = ['settled', 'refunded', 'released'].includes(String(booking?.securityDepositStatus || '').toLowerCase());
  const completed = ['RETURNED', 'COMPLETED'].includes(lifecycle) || String(booking?.status || '').toLowerCase() === 'completed';
  const pickupEvidence = useMemo(() => evidence.filter(item => item.phase === 'pickup' && item.mediaType === 'image'), [evidence]);
  const bySlot = useMemo(() => {
    const map = {};
    pickupEvidence.forEach(item => { const slot = slotOf(item); if (slot) map[slot] = item; });
    return map;
  }, [pickupEvidence]);
  const extras = pickupEvidence.filter(item => slotOf(item) === 'extra');
  const damage = pickupEvidence.filter(item => slotOf(item) === 'damage');
  const submitted = reports.some(report => report.phase === 'pickup' && report.actorRole === 'customer');
  const steps = [
    ['Trip in Progress', true],
    ['Return Inspection', submitted],
    ['Deposit Settlement', settled],
    ['Trip Completed', completed],
  ];

  const load = useCallback(async () => {
    if (!booking?.id) return;
    try {
      const result = await rideOnApi.getConditionEvidence(booking.id);
      setEvidence(result?.evidence || []);
      setReports(result?.reports || []);
      const mine = (result?.reports || []).find(report => report.phase === 'pickup' && report.actorRole === 'customer');
      if (mine && !hydrated.current) {
        hydrated.current = true;
        const match = CONDITIONS.find(([, api]) => api === mine.conditionStatus);
        if (match) setCondition(match[0]);
        if (mine.damageNotes) setNotes(mine.damageNotes);
      }
    } catch (loadError) {
      setError(loadError?.message || 'The return inspection could not be loaded.');
    } finally { setLoading(false); }
  }, [booking?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(permission => {
      if (permission.status !== 'granted') return null;
      return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    }).then(position => {
      if (position?.coords) setHere({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    }).catch(() => {});
  }, []);

  const ensureReturn = async () => {
    if (returnOpen) return;
    const result = await rideOnApi.requestRentalReturn(booking.id, { returnLocation: place || null, notes: notes.trim() || null });
    onUpdated?.(result?.booking || result);
    setReady(true);
  };
  const upload = async (slot, multiple = false) => {
    if (busy) return;
    setError('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') { setError('Allow photo access to add return inspection pictures.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: multiple, selectionLimit: multiple ? 6 : 1, quality: 0.7, base64: true });
      if (result.canceled || !result.assets?.length) return;
      setBusy(true);
      await ensureReturn();
      for (const asset of result.assets) {
        const base64 = await fileBase64(asset);
        await rideOnApi.uploadConditionEvidence(booking.id, { phase: 'pickup', mediaType: 'image', base64, contentType: asset.mimeType || 'image/jpeg', capturedAt: new Date().toISOString(), latitude: here?.latitude ?? null, longitude: here?.longitude ?? null, metadata: { slot } });
      }
      await load();
    } catch (uploadError) {
      setError(uploadError?.message || 'That photo could not be saved.');
    } finally { setBusy(false); }
  };
  const submit = async () => {
    if (busy) return;
    const missing = SLOTS.filter(([slot]) => !bySlot[slot]);
    if (missing.length) { setError(`Add the ${missing.map(([, label]) => label.toLowerCase()).join(', ')} photo${missing.length === 1 ? '' : 's'} before submitting.`); return; }
    setBusy(true);
    setError('');
    try {
      await ensureReturn();
      const apiStatus = CONDITIONS.find(([key]) => key === condition)?.[1] || 'no_damage';
      await rideOnApi.submitConditionReport(booking.id, { phase: 'pickup', conditionStatus: apiStatus, damageNotes: notes.trim(), evidenceCount: pickupEvidence.length, acknowledged: true, capturedAt: new Date().toISOString(), latitude: here?.latitude ?? null, longitude: here?.longitude ?? null, metadata: { slots: SLOTS.map(([slot]) => slot) } });
      onDone?.();
    } catch (submitError) {
      setError(submitError?.message || 'The return inspection could not be submitted.');
    } finally { setBusy(false); }
  };
  const openMap = () => {
    const target = dropoff ? `${dropoff.latitude},${dropoff.longitude}` : place;
    if (!target) return;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`).catch(() => {});
  };
  const arrived = nearDropoff(here, dropoff);

  return <View style={styles.root}>
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backText}>←</Text></TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Return Vehicle</Text>
        <Text style={styles.sub}>Complete the return inspection to close your trip</Text>
      </View>
    </View>
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <View style={styles.steps}>
          {steps.map(([label, done], index) => <View key={label} style={styles.step}>
            {index > 0 && <View style={[styles.line, (done || index === 1) && styles.lineOn]} />}
            <View style={[styles.dot, done && styles.dotOn, !done && index === 1 && styles.dotNow]}>{done ? <Text style={styles.check}>✓</Text> : null}</View>
            <Text style={[styles.stepLabel, (done || index === 1) && styles.stepOn]}>{label}</Text>
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
        <View style={styles.placeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Drop-off location</Text>
            <Text style={styles.place}>{place || 'Drop-off is on this booking'}</Text>
            <TouchableOpacity onPress={openMap} accessibilityRole="button"><Text style={styles.link}>View Map</Text></TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Return time</Text>
            <Text style={styles.place}>{returnDay || 'Set on the booking'}</Text>
            {!!returnTime && <Text style={styles.time}>{returnTime}</Text>}
          </View>
        </View>
        {arrived && <Text style={styles.arrived}>Near the drop-off</Text>}
      </View>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.section}>Vehicle Inspection</Text>
            <Text style={styles.hint}>Upload clear photos of the vehicle for this return.</Text>
          </View>
          <TouchableOpacity onPress={() => setGuide(true)} accessibilityRole="button"><Text style={styles.link}>Inspection Guide</Text></TouchableOpacity>
        </View>
        {loading ? <ActivityIndicator color={BUTTON} style={{ marginVertical: 16 }} /> : <>
          <Text style={styles.kicker}>Take photos from multiple angles</Text>
          <View style={styles.grid}>
            {SLOTS.map(([slot, label]) => <TouchableOpacity key={slot} style={styles.tile} onPress={() => upload(slot)} disabled={busy} accessibilityRole="button">
              {bySlot[slot]?.url ? <Image source={{ uri: bySlot[slot].url }} style={styles.tileImage} /> : <Text style={styles.camera}>＋</Text>}
              {!!bySlot[slot] && <Text style={styles.tileCheck}>✓</Text>}
              <View style={styles.tileCaption}><Text style={styles.tileLabel}>{label}</Text></View>
            </TouchableOpacity>)}
            <TouchableOpacity style={[styles.tile, styles.tileDash]} onPress={() => upload('extra')} disabled={busy} accessibilityRole="button">
              <Text style={styles.camera}>＋</Text>
              <Text style={styles.tileLabel}>Add More{extras.length ? ` (${extras.length})` : ''}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.section, { marginTop: 16 }]}>Damage photos</Text>
          <Text style={styles.hint}>Add photos of any new damage. Leave this empty when the vehicle is unchanged.</Text>
          <TouchableOpacity style={styles.damage} onPress={() => upload('damage', true)} disabled={busy} accessibilityRole="button">
            {damage.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}>{damage.map(item => <Image key={item.id} source={{ uri: item.url }} style={styles.damageImage} />)}</ScrollView> : <Text style={styles.hint}>Tap to upload photos</Text>}
          </TouchableOpacity>
        </>}
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>Vehicle Condition</Text>
        <View style={styles.conditions}>
          {CONDITIONS.map(([key, , label, hint]) => <TouchableOpacity key={key} style={[styles.condition, condition === key && styles.conditionOn]} onPress={() => setCondition(key)} accessibilityRole="button">
            <View style={[styles.radio, condition === key && styles.radioOn]} />
            <Text style={[styles.conditionTitle, condition === key && styles.stepOn]}>{label}</Text>
            <Text style={styles.hint}>{hint}</Text>
          </TouchableOpacity>)}
        </View>
        <Text style={[styles.section, { marginTop: 14 }]}>Additional notes</Text>
        <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Add any notes about the vehicle condition" placeholderTextColor="#9AA1AB" style={styles.notes} />
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity style={[styles.submit, busy && styles.submitOff]} disabled={busy} onPress={submit} accessibilityRole="button">
        <Text style={styles.submitText}>{busy ? 'Saving inspection…' : submitted ? 'Update inspection' : 'Submit Inspection'}</Text>
      </TouchableOpacity>
    </ScrollView>
    <Modal visible={guide} transparent animationType="fade" onRequestClose={() => setGuide(false)}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setGuide(false)}>
        <View style={styles.sheet}>
          <Text style={styles.section}>Inspection guide</Text>
          <Text style={styles.hint}>Photograph the front, both sides, the rear, and the odometer reading. Keep the whole panel in frame and use daylight where you can.</Text>
          <Text style={styles.hint}>Add damage photos only for marks that were not on the vehicle when you received it. RideOn keeps these with the return record.</Text>
          <TouchableOpacity onPress={() => setGuide(false)} accessibilityRole="button"><Text style={styles.link}>Close</Text></TouchableOpacity>
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
  page: { padding: 16, paddingTop: 8, paddingBottom: 28 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E8ECF0', padding: 14, marginBottom: 12 },
  steps: { flexDirection: 'row' },
  step: { flex: 1, alignItems: 'center' },
  line: { position: 'absolute', left: -18, right: 18, top: 9, height: 2, backgroundColor: '#E5E7EB' },
  lineOn: { backgroundColor: BUTTON },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D5DBE1', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: BUTTON, borderColor: BUTTON },
  dotNow: { borderColor: BUTTON },
  check: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  stepLabel: { color: MUTED, fontSize: 9, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  stepOn: { color: GREEN },
  vehicle: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  photo: { width: 92, height: 68, borderRadius: 12, backgroundColor: '#F3F5F7', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoImage: { width: '100%', height: '100%' },
  emoji: { fontSize: 28 },
  vehicleName: { color: INK, fontSize: 16, fontWeight: '800' },
  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  spec: { color: '#3C4652', fontSize: 11, fontWeight: '700', backgroundColor: '#F4F6F8', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  placeRow: { flexDirection: 'row', gap: 12 },
  kicker: { color: MUTED, fontSize: 11, fontWeight: '700' },
  place: { color: INK, fontSize: 14, fontWeight: '800', marginTop: 4 },
  time: { color: MUTED, fontSize: 12, marginTop: 2 },
  link: { color: GREEN, fontWeight: '800', marginTop: 4 },
  arrived: { alignSelf: 'flex-start', marginTop: 10, color: GREEN, fontWeight: '800', backgroundColor: '#E7F8EC', borderRadius: 10, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  section: { color: INK, fontSize: 16, fontWeight: '800' },
  hint: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  tile: { width: '31%', minHeight: 92, borderRadius: 12, backgroundColor: '#F4F6F8', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 6 },
  tileDash: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#C9D1D8', backgroundColor: '#FFFFFF' },
  tileImage: { ...StyleSheet.absoluteFillObject },
  tileCheck: { position: 'absolute', top: 6, right: 6, color: '#FFFFFF', backgroundColor: BUTTON, borderRadius: 8, overflow: 'hidden', paddingHorizontal: 4, fontSize: 10, fontWeight: '800' },
  tileCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.92)', paddingVertical: 3, paddingHorizontal: 2 },
  tileLabel: { color: INK, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  camera: { color: MUTED, fontSize: 22, fontWeight: '700' },
  damage: { minHeight: 84, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: '#C9D1D8', alignItems: 'center', justifyContent: 'center', marginTop: 8, padding: 10 },
  damageImage: { width: 72, height: 72, borderRadius: 10, marginRight: 8 },
  conditions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  condition: { flex: 1, borderWidth: 1, borderColor: '#E8ECF0', borderRadius: 14, padding: 8 },
  conditionOn: { borderColor: BUTTON, backgroundColor: '#F3FBF6' },
  radio: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#D5DBE1', marginBottom: 6 },
  radioOn: { borderColor: BUTTON, backgroundColor: BUTTON },
  conditionTitle: { color: INK, fontSize: 12, fontWeight: '800' },
  notes: { marginTop: 8, minHeight: 72, borderWidth: 1, borderColor: '#E8ECF0', borderRadius: 12, padding: 10, color: INK, textAlignVertical: 'top' },
  error: { color: '#B42318', fontSize: 13, marginBottom: 8 },
  submit: { height: 52, borderRadius: 26, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  submitOff: { backgroundColor: '#9CA3AF' },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 8 },
});
