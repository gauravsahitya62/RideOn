import React, { useMemo, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const dayCount = (pickupDate, pickupTime, returnDate, returnTime) => {
  if (!pickupDate || !returnDate) return 0;
  const start = new Date(`${pickupDate}T${pickupTime || '10:00'}:00`);
  const end = new Date(`${returnDate}T${returnTime || '10:00'}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
};
const imageOf = vehicle => vehicle?.images?.find(value => typeof value === 'string' && /^https?:\/\//i.test(value));
const specsOf = vehicle => [vehicle?.type, vehicle?.fuel, vehicle?.transmission].filter(Boolean);

export default function ExploreVehicles({
  mode = 'explore', city, location, pickupDate, pickupTime, returnDate, returnTime, category, sort,
  vehicles = [], catalog = [], savedIds = [], loading, error, activeFilters = 0,
  onBack, onCategory, onSort, onFilters, onLocation, onDates, onOpen, onBook, onToggleSave, onRetry,
}) {
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const counts = useMemo(() => ({
    all: catalog.length,
    scooter: catalog.filter(vehicle => vehicle.type === 'Scooter').length,
    bike: catalog.filter(vehicle => vehicle.type === 'Bike').length,
    car: catalog.filter(vehicle => vehicle.type === 'Car').length,
  }), [catalog]);
  const shown = favoritesOnly ? vehicles.filter(vehicle => savedIds.includes(String(vehicle.id))) : vehicles;
  const days = dayCount(pickupDate, pickupTime, returnDate, returnTime);
  const when = pickupDate && returnDate
    ? `${prettyDate(pickupDate)}, ${clock(pickupTime)} – ${prettyDate(returnDate)}, ${clock(returnTime)}${days ? ` (${days} day${days === 1 ? '' : 's'})` : ''}`
    : 'Choose dates';
  const chips = [
    { id: 'All', label: `All (${counts.all})` },
    { id: 'Scooter', label: `Scooters (${counts.scooter})` },
    { id: 'Bike', label: `Bikes (${counts.bike})` },
    ...(counts.car ? [{ id: 'Car', label: `Cars (${counts.car})` }] : []),
  ];
  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back"><Text style={styles.backText}>←</Text></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{mode === 'results' ? 'Available Vehicles' : 'Explore Vehicles'}</Text>
          <Text style={styles.sub}>{mode === 'results' ? `${shown.length} vehicle${shown.length === 1 ? '' : 's'} match these filters.` : 'Choose from the vehicles available in your city.'}</Text>
        </View>
        <TouchableOpacity onPress={() => setFavoritesOnly(value => !value)} style={styles.heart} accessibilityRole="button" accessibilityLabel="Saved vehicles"><Text style={styles.heartText}>{favoritesOnly ? '♥' : '♡'}</Text></TouchableOpacity>
      </View>

      <View style={styles.summary}>
        <TouchableOpacity style={styles.summaryCol} onPress={onLocation} accessibilityRole="button">
          <Text style={styles.summaryLabel}>⌖  Delivery location</Text>
          <Text style={styles.summaryValue} numberOfLines={2}>{location || city}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.summaryCol} onPress={() => setDatesOpen(true)} accessibilityRole="button">
          <Text style={styles.summaryLabel}>Dates & time</Text>
          <Text style={styles.summaryValue} numberOfLines={3}>{when}</Text>
        </TouchableOpacity>
      </View>

      {mode === 'results' ? <View style={styles.resultTools}>
        <TouchableOpacity style={styles.filterButton} onPress={onFilters} accessibilityRole="button"><Text style={styles.filterButtonText}>Filters{activeFilters ? ` (${activeFilters})` : ''}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.filterButton} onPress={() => setSortOpen(true)} accessibilityRole="button"><Text style={styles.filterButtonText}>{sort || 'Recommended'} ▾</Text></TouchableOpacity>
      </View> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {chips.map(chip => {
          const active = category === chip.id;
          return <TouchableOpacity key={chip.id} style={[styles.chip, active && styles.chipOn]} onPress={() => onCategory?.(chip.id)} accessibilityRole="button"><Text style={[styles.chipText, active && styles.chipTextOn]}>{chip.label}</Text></TouchableOpacity>;
        })}
        <TouchableOpacity style={[styles.chip, String(sort).startsWith('Price') && styles.chipOn]} onPress={() => setSortOpen(true)} accessibilityRole="button"><Text style={styles.chipText}>Price ▾</Text></TouchableOpacity>
        <TouchableOpacity style={styles.chip} onPress={onFilters} accessibilityRole="button"><Text style={styles.chipText}>Filters</Text></TouchableOpacity>
      </ScrollView>}

      {!!error && <TouchableOpacity onPress={onRetry}><Text style={styles.error}>{error}</Text></TouchableOpacity>}
      {loading && !shown.length ? <Text style={styles.empty}>Loading vehicles…</Text> : null}
      {!loading && !shown.length ? <Text style={styles.empty}>{favoritesOnly ? 'No saved vehicles in this list.' : `No vehicles match this search in ${city}.`}</Text> : null}
      {shown.map(vehicle => <VehicleRow key={vehicle.id} vehicle={vehicle} saved={savedIds.includes(String(vehicle.id))} onOpen={() => onOpen?.(vehicle)} onBook={() => onBook?.(vehicle)} onSave={() => onToggleSave?.(vehicle)} />)}
    </ScrollView>
    <SortSheet visible={sortOpen} value={sort} onClose={() => setSortOpen(false)} onPick={value => { onSort?.(value); setSortOpen(false); }} />
    <DateSheet visible={datesOpen} pickupDate={pickupDate} pickupTime={pickupTime} returnDate={returnDate} returnTime={returnTime} onClose={() => setDatesOpen(false)} onSave={next => { onDates?.(next); setDatesOpen(false); }} />
  </View>;
}

function VehicleRow({ vehicle, saved, onOpen, onBook, onSave }) {
  const image = imageOf(vehicle);
  return <TouchableOpacity style={styles.card} onPress={onOpen} accessibilityRole="button">
    <View style={styles.photo}>{image ? <Image source={{ uri: image }} style={styles.photoImage} /> : <Text style={styles.emoji}>{vehicle.emoji || '🛵'}</Text>}</View>
    <View style={{ flex: 1 }}>
      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={1}>{vehicle.name}</Text>
        <TouchableOpacity onPress={onSave} accessibilityRole="button" accessibilityLabel="Save vehicle"><Text style={styles.save}>{saved ? '♥' : '♡'}</Text></TouchableOpacity>
      </View>
      <Text style={styles.meta} numberOfLines={2}>{specsOf(vehicle).join(' · ') || 'RideOn vehicle'}</Text>
      {!!vehicle.registrationNumber && <Text style={styles.plate}>{vehicle.registrationNumber}</Text>}
      <View style={styles.cardFoot}>
        <View style={{ flex: 1 }}>
          {vehicle.deliveryAvailable ? <Text style={styles.delivery}>Delivery available</Text> : null}
          <Text style={styles.price}>{money(vehicle.price)}<Text style={styles.per}>/day</Text></Text>
        </View>
        <TouchableOpacity style={styles.book} onPress={onBook} accessibilityRole="button"><Text style={styles.bookText}>Book Now</Text></TouchableOpacity>
      </View>
    </View>
  </TouchableOpacity>;
}

function SortSheet({ visible, value, onClose, onPick }) {
  const options = ['Recommended', 'Price: low to high', 'Price: high to low', 'Name: A to Z'];
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity style={styles.shade} onPress={onClose} accessibilityRole="button">
      <View style={styles.sheet}>
        {options.map(option => <TouchableOpacity key={option} style={styles.sortRow} onPress={() => onPick(option)} accessibilityRole="button"><Text style={[styles.sortText, value === option && styles.sortOn]}>{option}</Text></TouchableOpacity>)}
      </View>
    </TouchableOpacity>
  </Modal>;
}

function DateSheet({ visible, pickupDate, pickupTime, returnDate, returnTime, onClose, onSave }) {
  const [pickup, setPickup] = useState(pickupDate || '');
  const [pickupClock, setPickupClock] = useState(pickupTime || '10:00');
  const [drop, setDrop] = useState(returnDate || '');
  const [dropClock, setDropClock] = useState(returnTime || '10:00');
  const [error, setError] = useState('');
  const save = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickup) || !/^\d{4}-\d{2}-\d{2}$/.test(drop) || !/^\d{2}:\d{2}$/.test(pickupClock) || !/^\d{2}:\d{2}$/.test(dropClock)) {
      setError('Use dates as YYYY-MM-DD and times as HH:mm.');
      return;
    }
    if (new Date(`${drop}T${dropClock}:00`) <= new Date(`${pickup}T${pickupClock}:00`)) {
      setError('Return must be after pickup.');
      return;
    }
    onSave({ pickupDate: pickup, pickupTime: pickupClock, returnDate: drop, returnTime: dropClock });
  };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.shade}>
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>Dates & time</Text>
        <Field label="Pickup date" value={pickup} onChangeText={setPickup} placeholder="YYYY-MM-DD" />
        <Field label="Pickup time" value={pickupClock} onChangeText={setPickupClock} placeholder="HH:mm" />
        <Field label="Return date" value={drop} onChangeText={setDrop} placeholder="YYYY-MM-DD" />
        <Field label="Return time" value={dropClock} onChangeText={setDropClock} placeholder="HH:mm" />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={styles.save} onPress={save} accessibilityRole="button"><Text style={styles.saveText}>Save dates</Text></TouchableOpacity>
      </View>
    </View>
  </Modal>;
}

function Field({ label, value, onChangeText, placeholder }) {
  return <View style={{ marginTop: 8 }}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#9AA3AD" autoCapitalize="none" style={styles.field} />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8FA' },
  page: { padding: 16, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 22, color: INK },
  title: { color: INK, fontSize: 26, fontWeight: '800' },
  sub: { color: '#7B848E', marginTop: 2, fontSize: 13 },
  heart: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  heartText: { color: GREEN, fontSize: 22 },
  summary: { marginTop: 14, backgroundColor: '#FFFFFF', borderRadius: 16, flexDirection: 'row' },
  summaryCol: { flex: 1, padding: 12 },
  summaryLabel: { color: '#7B848E', fontSize: 12 },
  summaryValue: { color: INK, fontWeight: '800', marginTop: 4 },
  chips: { gap: 8, paddingVertical: 14 },
  chip: { height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6E8EC', alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: BUTTON, borderColor: BUTTON },
  chipText: { color: INK, fontWeight: '700', fontSize: 13 },
  chipTextOn: { color: '#FFFFFF' },
  resultTools: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  filterButton: { flex: 1, height: 40, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  filterButtonText: { color: INK, fontWeight: '800' },
  error: { color: '#B23B3B', marginBottom: 8 },
  empty: { color: '#66707A', marginVertical: 12 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, marginBottom: 12, flexDirection: 'row', gap: 12 },
  photo: { width: 92, height: 92, borderRadius: 12, backgroundColor: '#F4F6F8', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoImage: { width: '100%', height: '100%' },
  emoji: { fontSize: 32 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: INK, fontSize: 16, fontWeight: '800' },
  save: { color: '#9AA3AD', fontSize: 18 },
  meta: { color: '#66707A', fontSize: 12, marginTop: 3 },
  plate: { color: '#3E4A54', fontSize: 12, marginTop: 3, fontWeight: '700' },
  cardFoot: { marginTop: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  delivery: { color: GREEN, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  price: { color: INK, fontSize: 16, fontWeight: '800' },
  per: { color: '#7B848E', fontSize: 12, fontWeight: '600' },
  book: { backgroundColor: BUTTON, borderRadius: 10, paddingHorizontal: 12, height: 34, alignItems: 'center', justifyContent: 'center' },
  bookText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  shade: { flex: 1, backgroundColor: '#11182788', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28 },
  sheetTitle: { color: INK, fontSize: 18, fontWeight: '800' },
  sortRow: { paddingVertical: 12 },
  sortText: { color: INK, fontSize: 15 },
  sortOn: { color: GREEN, fontWeight: '800' },
  fieldLabel: { color: '#66707A', fontSize: 12, marginBottom: 4 },
  field: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#E6E8EC', paddingHorizontal: 12, color: INK },
  save: { marginTop: 14, height: 48, borderRadius: 24, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontWeight: '800' },
});
