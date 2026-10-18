import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { rideOnApi } from '../services/api';

const INK = '#12161C';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const CITIES = { udaipur: { latitude: 24.5854, longitude: 73.7125 }, jaipur: { latitude: 26.9124, longitude: 75.7873 } };
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const lineOf = address => [address?.street, address?.area, address?.city, address?.postalCode].filter(Boolean).join(', ');

export default function DeliveryFlow({
  view = 'pick', city, location, addresses = [], selectedId, instructions = '', contactName, contactPhone, deliveryFee,
  onBack, onView, onSelectSaved, onContinue, onConfirm, onInstructions, onAdd, onEdit,
}) {
  const [query, setQuery] = useState(location?.address || '');
  const [point, setPoint] = useState(location?.latitude != null ? { latitude: Number(location.latitude), longitude: Number(location.longitude) } : null);
  const [label, setLabel] = useState(location?.address || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setQuery(location?.address || '');
    setLabel(location?.address || '');
    setPoint(location?.latitude != null && location?.longitude != null ? { latitude: Number(location.latitude), longitude: Number(location.longitude) } : null);
  }, [location?.address, location?.latitude, location?.longitude]);
  const chosen = addresses.find(item => item.id === selectedId) || null;
  const region = point
    ? { ...point, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : { ...(CITIES[String(city || '').toLowerCase()] || CITIES.udaipur), latitudeDelta: 0.12, longitudeDelta: 0.12 };

  const search = async () => {
    const address = query.trim();
    if (address.length < 4) return setError('Enter a longer address or nearby landmark.');
    setBusy(true); setError('');
    try {
      const result = await rideOnApi.geocodeAddress(address, city);
      if (!result?.location) return setError('We could not find that address. Try a landmark or tap the map.');
      setLabel(result.formattedAddress || address);
      setQuery(result.formattedAddress || address);
      setPoint({ latitude: Number(result.location.latitude), longitude: Number(result.location.longitude) });
    } catch (searchError) {
      setError(searchError?.code === 'GEOCODE_PROVIDER_NOT_CONFIGURED'
        ? 'Address search is not configured yet. Tap the map to choose the point.'
        : (searchError?.message || 'We could not find that address.'));
    } finally { setBusy(false); }
  };

  const useCurrent = async () => {
    setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') return setError('Location access was not granted. Search or tap the map instead.');
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = { latitude: Number(current.coords.latitude), longitude: Number(current.coords.longitude) };
      setPoint(next);
      if (!query.trim()) setLabel('Current location');
    } catch { setError('We could not read your current location.'); }
  };

  const continueWithMap = () => {
    const address = (label || query).trim();
    if (!address) return setError('Search, choose a saved address, or tap the map.');
    onContinue?.({ address, latitude: point?.latitude ?? null, longitude: point?.longitude ?? null });
  };

  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <TouchableOpacity onPress={view === 'pick' || view === 'addresses' ? onBack : () => onView?.(view === 'confirmAddress' ? 'addresses' : 'pick')} style={styles.back} accessibilityRole="button"><Text style={styles.backText}>←</Text></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{titleFor(view)}</Text>
          <Text style={styles.sub}>{subtitleFor(view)}</Text>
        </View>
      </View>

      {(view === 'pick' || view === 'addresses') && <>
        <View style={styles.search}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search for an area, landmark or address" placeholderTextColor="#9AA3AD" style={styles.searchInput} returnKeyType="search" onSubmitEditing={search} />
          <TouchableOpacity onPress={search} disabled={busy} accessibilityRole="button">{busy ? <ActivityIndicator color={GREEN} /> : <Text style={styles.searchGo}>Find</Text>}</TouchableOpacity>
        </View>
        <View style={styles.tools}>
          <TouchableOpacity style={styles.tool} onPress={useCurrent} accessibilityRole="button"><Text style={styles.toolText}>Use current location</Text></TouchableOpacity>
          <TouchableOpacity style={styles.tool} onPress={() => onView?.('pick')} accessibilityRole="button"><Text style={styles.toolText}>Select on map</Text></TouchableOpacity>
        </View>
      </>}

      {view === 'pick' && <View style={styles.mapWrap}>
        <MapView provider={Constants.appOwnership !== 'expo' && Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined} style={StyleSheet.absoluteFill} initialRegion={region} region={region} onPress={event => { setPoint(event.nativeEvent.coordinate); if (!label) setLabel(query.trim() || 'Selected on map'); }}>
          {point && <Marker coordinate={point} pinColor={BUTTON} />}
        </MapView>
      </View>}

      {(view === 'confirm' || view === 'confirmAddress') && <>
        {point && <View style={styles.mapWrap}>
          <MapView provider={Constants.appOwnership !== 'expo' && Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined} style={StyleSheet.absoluteFill} initialRegion={region} region={region} scrollEnabled={false}>
            <Marker coordinate={point} pinColor={BUTTON} />
          </MapView>
        </View>}
        <View style={styles.card}>
          <View style={styles.row}><Text style={styles.cardTitle}>Selected location</Text><TouchableOpacity onPress={onEdit || (() => onView?.('pick'))}><Text style={styles.link}>Edit</Text></TouchableOpacity></View>
          <Text style={styles.place}>{location?.address || label || 'Choose a location'}</Text>
          <Text style={styles.meta}>{city}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Delivery details</Text>
          <View style={styles.line}><Text style={styles.meta}>Delivery fee</Text><Text style={styles.value}>{deliveryFee != null ? money(deliveryFee) : 'Added on the booking quote'}</Text></View>
          <Text style={styles.note}>RideOn delivers to this address when doorstep delivery is selected. The fee comes from the booking quote.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Delivery instructions</Text>
          <TextInput value={instructions} onChangeText={text => onInstructions?.(text.slice(0, 200))} placeholder="Gate, landmark, or parking note" placeholderTextColor="#9AA3AD" multiline style={styles.instructions} />
          <Text style={styles.count}>{String(instructions || '').length}/200</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact</Text>
          <Text style={styles.place}>{contactName || 'Name is saved on your profile'}</Text>
          <Text style={styles.meta}>{contactPhone || 'Phone is saved on your profile'}</Text>
        </View>
      </>}

      {(view === 'pick' || view === 'addresses') && <>
        <View style={styles.row}><Text style={styles.section}>Saved addresses</Text>{view === 'pick' && <TouchableOpacity onPress={() => onView?.('addresses')}><Text style={styles.link}>Manage</Text></TouchableOpacity>}</View>
        {!addresses.length && <Text style={styles.meta}>No saved addresses yet.</Text>}
        {addresses.map(item => {
          const active = item.id === selectedId;
          return <TouchableOpacity key={item.id} style={[styles.address, active && styles.addressOn]} onPress={() => onSelectSaved?.(item)} accessibilityRole="button">
            <View style={[styles.radio, active && styles.radioOn]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.place}>{item.label || 'Address'}</Text>
              <Text style={styles.meta}>{lineOf(item)}</Text>
            </View>
          </TouchableOpacity>;
        })}
      </>}

      {view === 'addresses' && <View style={{ marginTop: 8 }}>
        <Text style={styles.section}>Add a new address</Text>
        {['Home', 'Work', 'Other'].map(kind => <TouchableOpacity key={kind} style={styles.add} onPress={() => onAdd?.(kind)} accessibilityRole="button"><Text style={styles.place}>Add {kind === 'Other' ? 'another' : kind.toLowerCase()} address</Text><Text style={styles.link}>›</Text></TouchableOpacity>)}
      </View>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
    <View style={styles.footer}>
      {view === 'pick' && <TouchableOpacity style={styles.button} onPress={continueWithMap} accessibilityRole="button"><Text style={styles.buttonText}>Continue with this location</Text></TouchableOpacity>}
      {view === 'addresses' && <TouchableOpacity style={styles.button} onPress={() => chosen ? onSelectSaved?.(chosen) : onView?.('pick')} accessibilityRole="button"><Text style={styles.buttonText}>{chosen ? 'Continue to address details' : 'Choose on the map'}</Text></TouchableOpacity>}
      {(view === 'confirm' || view === 'confirmAddress') && <TouchableOpacity style={styles.button} onPress={() => onConfirm?.({ address: (location?.address || label || (chosen ? lineOf(chosen) : '')).trim(), latitude: point?.latitude ?? location?.latitude ?? null, longitude: point?.longitude ?? location?.longitude ?? null })} accessibilityRole="button"><Text style={styles.buttonText}>{view === 'confirmAddress' ? 'Confirm address' : 'Confirm delivery location'}</Text></TouchableOpacity>}
    </View>
  </View>;
}

function titleFor(view) {
  if (view === 'addresses') return 'Delivery address';
  if (view === 'confirmAddress') return 'Confirm delivery address';
  if (view === 'confirm') return 'Delivery location';
  return 'Delivery location';
}
function subtitleFor(view) {
  if (view === 'addresses') return 'Select or add a delivery address.';
  if (view === 'confirm' || view === 'confirmAddress') return 'Review the address used for this booking.';
  return 'Where should we deliver the vehicle?';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8FA' },
  page: { padding: 16, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 22, color: INK },
  title: { color: INK, fontSize: 24, fontWeight: '800' },
  sub: { color: '#7B848E', marginTop: 2 },
  search: { marginTop: 14, backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 12, height: 48, flexDirection: 'row', alignItems: 'center' },
  searchInput: { flex: 1, color: INK },
  searchGo: { color: GREEN, fontWeight: '800' },
  tools: { flexDirection: 'row', gap: 8, marginTop: 10 },
  tool: { flex: 1, height: 42, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  toolText: { color: INK, fontWeight: '700', fontSize: 12 },
  mapWrap: { height: 220, borderRadius: 16, overflow: 'hidden', marginTop: 12, backgroundColor: '#E7EEF2' },
  section: { color: INK, fontSize: 16, fontWeight: '800', marginTop: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: GREEN, fontWeight: '800' },
  address: { marginTop: 8, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  addressOn: { backgroundColor: '#E7F8EC' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#C5CDD4' },
  radioOn: { borderColor: BUTTON, backgroundColor: BUTTON },
  place: { color: INK, fontWeight: '800' },
  meta: { color: '#66707A', fontSize: 12, marginTop: 3 },
  add: { marginTop: 8, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, flexDirection: 'row', justifyContent: 'space-between' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginTop: 12 },
  cardTitle: { color: INK, fontWeight: '800' },
  line: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  value: { color: INK, fontWeight: '800' },
  note: { color: GREEN, fontSize: 12, lineHeight: 17, marginTop: 8 },
  instructions: { minHeight: 72, color: INK, marginTop: 8, textAlignVertical: 'top' },
  count: { alignSelf: 'flex-end', color: '#9AA3AD', fontSize: 11 },
  error: { color: '#B23B3B', marginTop: 10 },
  footer: { padding: 16 },
  button: { height: 52, borderRadius: 26, backgroundColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
});
