import React, { useRef } from 'react';
import { Image, ImageBackground, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const GREEN = '#067A4A';
const BUTTON = '#07A574';
const INK = '#12161C';
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const REGIONS = {
  Udaipur: 'Rajasthan, India', Jaipur: 'Rajasthan, India', Goa: 'Goa, India', Mumbai: 'Maharashtra, India',
  Bangalore: 'Karnataka, India', Delhi: 'Delhi, India', Pune: 'Maharashtra, India', Hyderabad: 'Telangana, India',
};
const HEROES = {
  Udaipur: require('../../assets/city-udaipur.jpg'),
  Jaipur: require('../../assets/city-jaipur.jpg'),
  Goa: require('../../assets/city-goa.jpg'),
  Mumbai: require('../../assets/city-mumbai.jpg'),
  Bangalore: require('../../assets/city-bangalore.jpg'),
  Delhi: require('../../assets/city-delhi.jpg'),
  Pune: require('../../assets/city-pune.jpg'),
  Hyderabad: require('../../assets/city-hyderabad.jpg'),
};
const CHIPS = [
  { id: 'All', label: 'All' },
  { id: 'Scooter', label: 'Scooters' },
  { id: 'Bike', label: 'Bikes' },
  { id: 'Near', label: 'Near Me' },
];

export default function HomeScreen({ city, name, search, onSearch, category, onCategory, vehicles, loading, error, onRetry, onCity, onBell, onProfile, onFilter, onOpen, onBook, onMap }) {
  const listRef = useRef(null);
  const initials = String(name || 'Guest').split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  const hero = HEROES[city] || HEROES.Udaipur;
  return <ScrollView ref={listRef} style={styles.screen} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
    <View style={styles.header}>
      <TouchableOpacity style={styles.city} onPress={onCity} accessibilityRole="button">
        <Text style={styles.pin}>⌖</Text>
        <View>
          <Text style={styles.cityName}>{city} ▾</Text>
          <Text style={styles.cityRegion}>{REGIONS[city] || 'India'}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.headerActions}>
        <TouchableOpacity style={styles.bell} onPress={onBell} accessibilityRole="button" accessibilityLabel="Notifications"><Text style={styles.bellIcon}>🔔</Text><View style={styles.bellDot} /></TouchableOpacity>
        <TouchableOpacity style={styles.avatar} onPress={onProfile} accessibilityRole="button"><Text style={styles.avatarText}>{initials}</Text></TouchableOpacity>
      </View>
    </View>

    <View style={styles.hero}>
      <View style={styles.heroCopy}>
        <Text style={styles.heroTitle}>Explore <Text style={styles.heroTitleGreen}>{city}</Text></Text>
        <Text style={styles.heroSub}>Rent bikes and scooters for your next adventure.</Text>
        <TouchableOpacity style={styles.find} onPress={() => listRef.current?.scrollToEnd?.({ animated: true })} accessibilityRole="button">
          <Text style={styles.findText}>Find a Ride</Text><Text style={styles.findArrow}>→</Text>
        </TouchableOpacity>
      </View>
      <Image source={hero} style={styles.heroPhoto} />
    </View>

    <View style={styles.searchRow}>
      <View style={styles.search}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput value={search} onChangeText={onSearch} placeholder="Search for bikes or scooters..." placeholderTextColor="#9AA3AD" style={styles.searchInput} returnKeyType="search" />
      </View>
      <TouchableOpacity style={styles.filter} onPress={onFilter} accessibilityRole="button" accessibilityLabel="Filters"><Text style={styles.filterIcon}>⇅</Text></TouchableOpacity>
    </View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {CHIPS.map(chip => {
        const active = chip.id === 'Near' ? false : category === chip.id;
        return <TouchableOpacity key={chip.id} style={[styles.chip, active && styles.chipOn]} onPress={() => chip.id === 'Near' ? onMap() : onCategory(chip.id)} accessibilityRole="button" accessibilityState={{ selected: active }}>
          <Text style={[styles.chipText, active && styles.chipTextOn]}>{chip.label}</Text>
        </TouchableOpacity>;
      })}
    </ScrollView>

    <TouchableOpacity style={styles.mapCard} onPress={onMap} accessibilityRole="button">
      <ImageBackground source={hero} style={styles.mapPhoto} imageStyle={styles.mapPhotoImage}>
        <View style={styles.mapShade} />
        <Text style={styles.mapLabel}>{city === 'Udaipur' ? 'Fateh Sagar Lake' : city}</Text>
        <View style={styles.mapButton}><Text style={styles.mapButtonText}>View on Map</Text></View>
      </ImageBackground>
    </TouchableOpacity>

    <View style={styles.sectionHead}>
      <Text style={styles.section}>Available Vehicles</Text>
      <TouchableOpacity onPress={() => onCategory('All')} accessibilityRole="button"><Text style={styles.seeAll}>See All →</Text></TouchableOpacity>
    </View>
    {!!error && <TouchableOpacity onPress={onRetry}><Text style={styles.error}>{error}</Text></TouchableOpacity>}
    {loading && !vehicles.length ? <Text style={styles.empty}>Loading vehicles…</Text> : null}
    {!loading && !vehicles.length ? <Text style={styles.empty}>No vehicles match this search in {city}.</Text> : null}
    <View style={styles.grid}>
      {vehicles.map(vehicle => <VehicleTile key={vehicle.id} vehicle={vehicle} onOpen={() => onOpen(vehicle)} onBook={() => onBook(vehicle)} />)}
    </View>
  </ScrollView>;
}

function VehicleTile({ vehicle, onOpen, onBook }) {
  return <TouchableOpacity style={styles.tile} onPress={onOpen} accessibilityRole="button">
    <View style={styles.tileArt}>
      {vehicle.images?.[0] ? <Image source={{ uri: vehicle.images[0] }} style={styles.tileImage} /> : <Text style={styles.tileEmoji}>{vehicle.emoji || '🛵'}</Text>}
    </View>
    <Text style={styles.tileName} numberOfLines={1}>{vehicle.name}</Text>
    <Text style={styles.tileMeta} numberOfLines={1}>{[vehicle.fuel, vehicle.transmission].filter(Boolean).join(' · ') || vehicle.type}</Text>
    <View style={styles.tileFoot}>
      <Text style={styles.price}>{money(vehicle.price)}<Text style={styles.per}> / day</Text></Text>
      <TouchableOpacity style={styles.book} onPress={onBook} accessibilityRole="button"><Text style={styles.bookText}>Book Now</Text></TouchableOpacity>
    </View>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F8FA' },
  page: { padding: 16, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  city: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pin: { color: BUTTON, fontSize: 18 },
  cityName: { color: INK, fontSize: 16, fontWeight: '800' },
  cityRegion: { color: '#7B848E', fontSize: 12, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bell: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  bellIcon: { fontSize: 16 },
  bellDot: { position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E11D48' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E7EEF5', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: INK, fontSize: 13, fontWeight: '800' },
  hero: { marginTop: 16, backgroundColor: '#E7F8EC', borderRadius: 22, height: 156, flexDirection: 'row', overflow: 'hidden' },
  heroCopy: { flex: 1, padding: 16, justifyContent: 'center' },
  heroTitle: { color: INK, fontSize: 24, lineHeight: 28, fontWeight: '800' },
  heroTitleGreen: { color: GREEN, fontSize: 24, lineHeight: 28, fontWeight: '800' },
  heroSub: { color: '#3E4A54', fontSize: 13, lineHeight: 18, marginTop: 6 },
  find: { marginTop: 12, alignSelf: 'flex-start', backgroundColor: BUTTON, borderRadius: 12, paddingHorizontal: 14, height: 36, flexDirection: 'row', alignItems: 'center', gap: 6 },
  findText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  findArrow: { color: '#FFFFFF', fontWeight: '800' },
  heroPhoto: { width: 132, height: 156 },
  searchRow: { marginTop: 14, flexDirection: 'row', gap: 10 },
  search: { flex: 1, height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#E6E8EC', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  searchIcon: { color: '#8B949E', fontSize: 16, marginRight: 6 },
  searchInput: { flex: 1, color: INK, fontSize: 14, paddingVertical: 0 },
  filter: { width: 48, height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#E6E8EC', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  filterIcon: { color: INK, fontSize: 16, fontWeight: '700' },
  chips: { gap: 8, paddingVertical: 14 },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: '#E6E8EC', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: '#E7F8EC', borderColor: BUTTON },
  chipText: { color: '#3E4A54', fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: GREEN },
  mapCard: { height: 150, borderRadius: 18, overflow: 'hidden', backgroundColor: '#D7E7EA' },
  mapPhoto: { flex: 1, justifyContent: 'flex-end', padding: 12 },
  mapPhotoImage: { opacity: 0.55 },
  mapShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(214,236,232,0.45)' },
  mapLabel: { color: INK, fontWeight: '800', marginBottom: 8 },
  mapButton: { alignSelf: 'flex-end', backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 12, height: 34, justifyContent: 'center' },
  mapButtonText: { color: INK, fontWeight: '800', fontSize: 12 },
  sectionHead: { marginTop: 18, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { color: INK, fontSize: 18, fontWeight: '800' },
  seeAll: { color: BUTTON, fontWeight: '800', fontSize: 13 },
  error: { color: '#B23B3B', marginBottom: 8 },
  empty: { color: '#66707A', marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: { width: '48%', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 10, marginBottom: 12 },
  tileArt: { height: 110, borderRadius: 14, backgroundColor: '#F4F6F8', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileImage: { width: '100%', height: '100%' },
  tileEmoji: { fontSize: 42 },
  tileName: { marginTop: 8, color: INK, fontSize: 14, fontWeight: '800' },
  tileMeta: { color: '#7B848E', fontSize: 11, marginTop: 3 },
  tileFoot: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  price: { color: INK, fontSize: 13, fontWeight: '800', flex: 1 },
  per: { color: '#7B848E', fontSize: 11, fontWeight: '600' },
  book: { backgroundColor: BUTTON, borderRadius: 10, paddingHorizontal: 8, height: 30, alignItems: 'center', justifyContent: 'center' },
  bookText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
});
