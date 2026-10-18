import React, { useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
const prettyDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return 'Choose date';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
const TYPE_ICON = { All: '⊞', Scooter: '🛵', Bike: '🏍️', Car: '🚘' };

export default function SearchFilters({
  city, location, pickupDate, pickupTime, returnDate, returnTime, catalog = [],
  draftCategory, draftSort, draftMinPrice, draftMaxPrice, draftTransmission, draftFuel, draftBrand, error,
  onBack, onCategory, onSort, onMinPrice, onMaxPrice, onTransmission, onFuel, onBrand, onApply, onReset, onLocation, onDates,
}) {
  const [datesOpen, setDatesOpen] = useState(false);
  const prices = catalog.map(vehicle => Number(vehicle.price)).filter(value => Number.isFinite(value));
  const low = prices.length ? Math.min(...prices) : 0;
  const high = prices.length ? Math.max(...prices) : 0;
  const selectedLow = draftMinPrice !== '' && Number.isFinite(Number(draftMinPrice)) ? Number(draftMinPrice) : low;
  const selectedHigh = draftMaxPrice !== '' && Number.isFinite(Number(draftMaxPrice)) ? Number(draftMaxPrice) : high;
  const types = useMemo(() => ['All', ...unique(catalog.map(vehicle => vehicle.type))], [catalog]);
  const brands = useMemo(() => unique(catalog.map(vehicle => vehicle.make)), [catalog]);
  const transmissions = useMemo(() => unique(catalog.map(vehicle => vehicle.transmission)), [catalog]);
  const fuels = useMemo(() => unique(catalog.map(vehicle => vehicle.fuel)), [catalog]);
  const sorts = [['Recommended', 'Recommended'], ['Price: low to high', 'Price: Low to High'], ['Price: high to low', 'Price: High to Low'], ['Name: A to Z', 'Name: A to Z']];
  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back"><Text style={styles.backText}>←</Text></TouchableOpacity>
        <Text style={styles.title}>Search & Filters</Text>
        <Text style={styles.sub}>Find the perfect vehicle for your ride</Text>
      </View>

      <TouchableOpacity style={styles.location} onPress={onLocation} accessibilityRole="button">
        <Text style={styles.pin}>📍</Text>
        <Text style={styles.locationText} numberOfLines={1}>{location || city}</Text>
        <Text style={styles.change}>Change</Text>
      </TouchableOpacity>

      <View style={styles.dates}>
        <TouchableOpacity style={styles.date} onPress={() => setDatesOpen(true)} accessibilityRole="button">
          <Text style={styles.dateIcon}>📅</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateLabel}>Pickup</Text>
            <Text style={styles.dateValue}>{prettyDate(pickupDate)}</Text>
            <Text style={styles.dateTime}>{pickupDate ? clock(pickupTime) : ''}</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.arrow}>›</Text>
        <TouchableOpacity style={styles.date} onPress={() => setDatesOpen(true)} accessibilityRole="button">
          <Text style={styles.dateIcon}>📅</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateLabel}>Return</Text>
            <Text style={styles.dateValue}>{prettyDate(returnDate)}</Text>
            <Text style={styles.dateTime}>{returnDate ? clock(returnTime) : ''}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Vehicle Type</Text>
      <View style={styles.typeRow}>
        {types.map(type => {
          const active = draftCategory === type;
          return <TouchableOpacity key={type} style={[styles.typeCard, active && styles.typeCardOn]} onPress={() => onCategory?.(type)} accessibilityRole="button" accessibilityState={{ selected: active }}>
            <Text style={[styles.typeIcon, active && styles.typeIconOn]}>{TYPE_ICON[type] || '🛵'}</Text>
            <Text style={[styles.typeLabel, active && styles.typeLabelOn]}>{type}</Text>
          </TouchableOpacity>;
        })}
      </View>

      {prices.length > 0 && <>
        <Text style={styles.section}>Price Range (per day)</Text>
        <RangeSlider min={low} max={high} lowValue={Math.min(selectedLow, selectedHigh)} highValue={Math.max(selectedLow, selectedHigh)} onChange={(nextLow, nextHigh) => { onMinPrice?.(String(nextLow)); onMaxPrice?.(String(nextHigh)); }} />
      </>}

      {!!transmissions.length && <>
        <Text style={styles.section}>Transmission</Text>
        <View style={styles.pills}>
          <Pill label="All" active={draftTransmission === 'Any'} onPress={() => onTransmission?.('Any')} />
          {transmissions.map(item => <Pill key={item} label={item} active={String(draftTransmission).toLowerCase() === String(item).toLowerCase()} onPress={() => onTransmission?.(item)} />)}
        </View>
      </>}
      {!!fuels.length && <>
        <Text style={styles.section}>Fuel</Text>
        <View style={styles.pills}>
          <Pill label="All" active={draftFuel === 'Any'} onPress={() => onFuel?.('Any')} />
          {fuels.map(item => <Pill key={item} label={item} active={String(draftFuel).toLowerCase() === String(item).toLowerCase()} onPress={() => onFuel?.(item)} />)}
        </View>
      </>}
      {!!brands.length && <>
        <Text style={styles.section}>Brand</Text>
        <View style={styles.pills}>
          <Pill label="All" active={!draftBrand || draftBrand === 'All'} onPress={() => onBrand?.('All')} />
          {brands.map(item => <Pill key={item} label={item} active={draftBrand === item} onPress={() => onBrand?.(item)} />)}
        </View>
      </>}

      <Text style={styles.section}>Sort By</Text>
      <View style={styles.sortGrid}>
        {sorts.map(([value, label]) => {
          const active = draftSort === value;
          return <TouchableOpacity key={value} style={styles.sort} onPress={() => onSort?.(value)} accessibilityRole="button" accessibilityState={{ selected: active }}>
            <View style={[styles.radio, active && styles.radioOn]}>{active && <View style={styles.radioDot} />}</View>
            <Text style={styles.sortText}>{label}</Text>
          </TouchableOpacity>;
        })}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
    <View style={styles.footer}>
      <TouchableOpacity style={styles.reset} onPress={onReset} accessibilityRole="button"><Text style={styles.resetText}>Reset</Text></TouchableOpacity>
      <TouchableOpacity style={styles.apply} onPress={onApply} accessibilityRole="button"><Text style={styles.applyText}>Apply Filters  →</Text></TouchableOpacity>
    </View>
    <DateSheet visible={datesOpen} pickupDate={pickupDate} pickupTime={pickupTime} returnDate={returnDate} returnTime={returnTime} onClose={() => setDatesOpen(false)} onSave={next => { onDates?.(next); setDatesOpen(false); }} />
  </View>;
}

function Pill({ label, active, onPress }) {
  return <TouchableOpacity style={[styles.pill, active && styles.pillOn]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}>
    <Text style={[styles.pillText, active && styles.pillTextOn]}>{label}</Text>
  </TouchableOpacity>;
}

function RangeSlider({ min, max, lowValue, highValue, onChange }) {
  const width = useRef(1);
  const lowRef = useRef(lowValue);
  const highRef = useRef(highValue);
  const grant = useRef({ low: lowValue, high: highValue });
  lowRef.current = lowValue;
  highRef.current = highValue;
  const span = Math.max(1, max - min);
  const fromDelta = (origin, dx) => Math.round(origin + (dx / width.current) * span);
  const lowPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { grant.current = { low: lowRef.current, high: highRef.current }; },
    onPanResponderMove: (_, gesture) => {
      const next = Math.max(min, Math.min(grant.current.high, fromDelta(grant.current.low, gesture.dx)));
      onChange(next, grant.current.high);
    },
  })).current;
  const highPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { grant.current = { low: lowRef.current, high: highRef.current }; },
    onPanResponderMove: (_, gesture) => {
      const next = Math.min(max, Math.max(grant.current.low, fromDelta(grant.current.high, gesture.dx)));
      onChange(grant.current.low, next);
    },
  })).current;
  const left = max === min ? 0.5 : ((lowValue - min) / span);
  const right = max === min ? 0.5 : ((highValue - min) / span);
  return <View style={styles.sliderWrap}>
    <View style={styles.sliderLabels}><Text style={styles.sliderEnd}>{money(min)}</Text><Text style={styles.sliderEnd}>{money(max)}</Text></View>
    <View style={styles.bubble}><Text style={styles.bubbleText}>{money(lowValue)} – {money(highValue)}</Text></View>
    <View style={styles.track} onLayout={event => { width.current = Math.max(1, event.nativeEvent.layout.width); }}>
      <View style={styles.trackBase} />
      <View style={[styles.trackOn, { left: `${left * 100}%`, width: `${Math.max(0, right - left) * 100}%` }]} />
      <View {...lowPan.panHandlers} style={[styles.handle, { left: `${left * 100}%` }]} />
      <View {...highPan.panHandlers} style={[styles.handle, { left: `${right * 100}%` }]} />
    </View>
  </View>;
}

function DateSheet({ visible, pickupDate, pickupTime, returnDate, returnTime, onClose, onSave }) {
  const [pickup, setPickup] = useState(pickupDate || '');
  const [pickupClock, setPickupClock] = useState(pickupTime || '10:00');
  const [drop, setDrop] = useState(returnDate || '');
  const [dropClock, setDropClock] = useState(returnTime || '10:00');
  const [error, setError] = useState('');
  const save = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickup) || !/^\d{4}-\d{2}-\d{2}$/.test(drop) || !/^\d{2}:\d{2}$/.test(pickupClock) || !/^\d{2}:\d{2}$/.test(dropClock)) return setError('Use dates as YYYY-MM-DD and times as HH:mm.');
    if (new Date(`${drop}T${dropClock}:00`) <= new Date(`${pickup}T${pickupClock}:00`)) return setError('Return must be after pickup.');
    onSave({ pickupDate: pickup, pickupTime: pickupClock, returnDate: drop, returnTime: dropClock });
  };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.shade}><View style={styles.sheet}>
      <Text style={styles.sheetTitle}>Dates & time</Text>
      {[['Pickup date', pickup, setPickup, 'YYYY-MM-DD'], ['Pickup time', pickupClock, setPickupClock, 'HH:mm'], ['Return date', drop, setDrop, 'YYYY-MM-DD'], ['Return time', dropClock, setDropClock, 'HH:mm']].map(([label, value, setter, placeholder]) => <TextInput key={label} value={value} onChangeText={setter} placeholder={`${label} (${placeholder})`} placeholderTextColor="#9AA3AD" autoCapitalize="none" style={styles.input} />)}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity style={[styles.apply, { marginTop: 14 }]} onPress={save} accessibilityRole="button"><Text style={styles.applyText}>Save dates</Text></TouchableOpacity>
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F7FB' },
  page: { padding: 16, paddingBottom: 28 },
  header: { alignItems: 'center', marginBottom: 16, minHeight: 58, justifyContent: 'center' },
  back: { position: 'absolute', left: 0, top: 0, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 22, color: INK },
  title: { color: INK, fontSize: 22, fontWeight: '800' },
  sub: { color: '#8B95A1', marginTop: 4, fontSize: 13 },
  location: { backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pin: { fontSize: 16 },
  locationText: { flex: 1, color: INK, fontWeight: '700', fontSize: 15 },
  change: { color: '#2F80ED', fontWeight: '700' },
  dates: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  date: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  dateIcon: { fontSize: 16 },
  dateLabel: { color: '#8B95A1', fontSize: 12 },
  dateValue: { color: INK, fontWeight: '800', marginTop: 2, fontSize: 13 },
  dateTime: { color: '#3E4A54', marginTop: 2, fontSize: 12 },
  arrow: { color: '#9AA3AD', fontSize: 22, fontWeight: '300' },
  section: { marginTop: 22, marginBottom: 12, color: INK, fontSize: 16, fontWeight: '800' },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeCard: { flex: 1, height: 84, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6EAF0', alignItems: 'center', justifyContent: 'center' },
  typeCardOn: { backgroundColor: '#E7F8EC', borderColor: '#B7E4C7' },
  typeIcon: { fontSize: 22, color: '#243044' },
  typeIconOn: { color: GREEN },
  typeLabel: { marginTop: 6, color: '#243044', fontWeight: '700', fontSize: 13 },
  typeLabelOn: { color: GREEN },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6EAF0', alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: '#E7F8EC', borderColor: '#B7E4C7' },
  pillText: { color: '#243044', fontWeight: '700' },
  pillTextOn: { color: GREEN },
  sliderWrap: { paddingTop: 4 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderEnd: { color: '#66707A', fontSize: 13 },
  bubble: { alignSelf: 'center', marginTop: 8, backgroundColor: '#DFF6E8', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  bubbleText: { color: GREEN, fontWeight: '800', fontSize: 13 },
  track: { height: 36, marginTop: 8 },
  trackBase: { position: 'absolute', left: 0, right: 0, top: 16, height: 4, borderRadius: 2, backgroundColor: '#E4E8EE' },
  trackOn: { position: 'absolute', top: 16, height: 4, backgroundColor: BUTTON, borderRadius: 2 },
  handle: { position: 'absolute', top: 5, width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: BUTTON, marginLeft: -13 },
  sortGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  sort: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#C5CDD4', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: BUTTON },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: BUTTON },
  sortText: { color: INK, fontWeight: '600', fontSize: 14 },
  error: { color: '#B23B3B', marginTop: 8 },
  footer: { flexDirection: 'row', gap: 10, padding: 16, backgroundColor: '#F4F7FB' },
  reset: { flex: 1, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: BUTTON, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  resetText: { color: GREEN, fontWeight: '800', fontSize: 16 },
  apply: { flex: 1.3, height: 52, borderRadius: 26, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  shade: { flex: 1, backgroundColor: '#11182788', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28 },
  sheetTitle: { color: INK, fontSize: 18, fontWeight: '800' },
  input: { height: 46, borderRadius: 12, backgroundColor: '#F7F8FA', borderWidth: 1, borderColor: '#E6E8EC', paddingHorizontal: 12, color: INK, marginTop: 8 },
});
