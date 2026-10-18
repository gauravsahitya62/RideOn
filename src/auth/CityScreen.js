import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { StepBars, StepDots } from './OnboardingSteps';

const GREEN = '#067A4A';
const BUTTON = '#07A574';
const INK = '#12161C';
const ridePhoto = require('../../assets/welcome-ride.jpg');

const POPULAR = [
  { name: 'Goa', tag: 'Beaches & Rides', image: require('../../assets/city-goa.jpg') },
  { name: 'Jaipur', tag: 'Royal Heritage', image: require('../../assets/city-jaipur.jpg') },
  { name: 'Mumbai', tag: 'City Vibes', image: require('../../assets/city-mumbai.jpg') },
  { name: 'Bangalore', tag: 'Tech & Travel', image: require('../../assets/city-bangalore.jpg') },
];

const RECENT = [
  { name: 'Udaipur', tag: 'Rajasthan', image: require('../../assets/city-udaipur.jpg') },
  { name: 'Delhi', tag: 'Delhi NCR', image: require('../../assets/city-delhi.jpg') },
  { name: 'Pune', tag: 'Maharashtra', image: require('../../assets/city-pune.jpg') },
  { name: 'Hyderabad', tag: 'Telangana', image: require('../../assets/city-hyderabad.jpg') },
];

export default function CityScreen({ onBack, onDone }) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [recents, setRecents] = useState(RECENT);
  const [showAll, setShowAll] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState('');
  const needle = query.trim().toLowerCase();
  const popular = useMemo(() => {
    const source = showAll ? [...POPULAR, ...RECENT] : POPULAR;
    return source.filter(city => !needle || `${city.name} ${city.tag}`.toLowerCase().includes(needle));
  }, [needle, showAll]);
  const recent = useMemo(() => recents.filter(city => !needle || `${city.name} ${city.tag}`.toLowerCase().includes(needle)), [needle, recents]);

  const choose = city => { setSelected(city); setLocationNote(''); };
  const finish = async () => {
    if (selected) { try { await SecureStore.setItemAsync('rideon_city', selected); } catch {} }
    onDone();
  };
  const useLocation = async () => {
    if (locating) return;
    setLocating(true);
    setLocationNote('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') { setLocationNote('Location permission is off. Choose a city below.'); return; }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const places = await Location.reverseGeocodeAsync(position.coords);
      const place = places?.[0] || {};
      const found = [place.city, place.subregion, place.district, place.region].filter(Boolean);
      const known = [...POPULAR, ...RECENT];
      const match = known.find(city => found.some(name => String(name).toLowerCase().includes(city.name.toLowerCase())));
      if (match) choose(match.name);
      else setLocationNote(found[0] ? `You're near ${found[0]}. Pick a city below.` : 'Choose a city below.');
    } catch {
      setLocationNote('We could not read your location. Choose a city below.');
    } finally {
      setLocating(false);
    }
  };

  return <View style={styles.screen}>
    <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
    <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + 10, paddingBottom: Math.max(insets.bottom, 12) + 8 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.top}>
        <StepBars step={3} />
        <TouchableOpacity onPress={onDone} accessibilityRole="button" hitSlop={12}><Text style={styles.skip}>Skip</Text></TouchableOpacity>
      </View>

      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.title}>Where do you{'\n'}want to <Text style={styles.titleGreen}>ride?</Text></Text>
          <Text style={styles.sub}>Choose your city to find available bikes and scooters near you.</Text>
        </View>
        <View style={styles.art} pointerEvents="none">
          <View style={styles.mapBlob} />
          <View style={[styles.pin, { top: 8, right: 18 }]} />
          <View style={[styles.pin, { top: 36, right: 52 }]} />
          <View style={[styles.pin, { top: 58, right: 28 }]} />
          <Image source={ridePhoto} style={styles.rider} />
        </View>
      </View>

      <View style={styles.search}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search for a city" placeholderTextColor="#9AA3AD" style={styles.searchInput} returnKeyType="search" />
      </View>

      <TouchableOpacity style={styles.location} onPress={useLocation} accessibilityRole="button">
        <View style={styles.locationMark}><View style={styles.locationDot} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.locationTitle}>{locating ? 'Finding your location…' : 'Use my current location'}</Text>
          <Text style={styles.locationSub}>Find rentals near you</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
      {!!locationNote && <Text style={styles.note}>{locationNote}</Text>}

      <View style={styles.sectionHead}>
        <Text style={styles.section}>Popular Destinations</Text>
        <TouchableOpacity onPress={() => setShowAll(value => !value)} accessibilityRole="button"><Text style={styles.link}>{showAll ? 'Show less' : 'See All'}</Text></TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.destinations}>
        {popular.map(city => <TouchableOpacity key={city.name} style={styles.destination} onPress={() => choose(city.name)} accessibilityRole="button" accessibilityState={{ selected: selected === city.name }}>
          <Image source={city.image} style={[styles.destinationPhoto, selected === city.name && styles.destinationOn]} />
          <Text style={styles.destinationName}>{city.name}</Text>
          <Text style={styles.destinationTag}>{city.tag}</Text>
        </TouchableOpacity>)}
      </ScrollView>

      <View style={styles.sectionHead}>
        <Text style={styles.section}>Recent Locations</Text>
        <TouchableOpacity onPress={() => { setRecents([]); if (RECENT.some(city => city.name === selected)) setSelected(''); }} accessibilityRole="button"><Text style={styles.link}>Clear</Text></TouchableOpacity>
      </View>
      {recent.map(city => <TouchableOpacity key={city.name} style={[styles.recent, selected === city.name && styles.recentOn]} onPress={() => choose(city.name)} accessibilityRole="button" accessibilityState={{ selected: selected === city.name }}>
        <Image source={city.image} style={styles.recentPhoto} />
        <View style={{ flex: 1 }}>
          <Text style={styles.recentName}>{city.name}</Text>
          <Text style={styles.recentTag}>{city.tag}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>)}
      {!recent.length && <Text style={styles.empty}>No recent locations.</Text>}

      <View style={styles.nav}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back"><Text style={styles.backArrow}>←</Text></TouchableOpacity>
        <StepDots step={3} />
        <TouchableOpacity style={styles.nextButton} onPress={finish} accessibilityRole="button" accessibilityLabel="Next">
          <Text style={styles.nextText}>Next</Text>
          <Text style={styles.nextArrow}>→</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  page: { paddingHorizontal: 22 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  progressOn: { width: 26, height: 5, borderRadius: 3, backgroundColor: BUTTON },
  progressOff: { width: 36, height: 5, borderRadius: 3, backgroundColor: '#E6E8EC' },
  skip: { color: INK, fontSize: 16, fontWeight: '600' },
  hero: { marginTop: 22, minHeight: 132 },
  heroCopy: { paddingRight: 108 },
  title: { color: INK, fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8 },
  titleGreen: { color: GREEN, fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8 },
  sub: { marginTop: 10, color: '#5E6872', fontSize: 15, lineHeight: 21 },
  art: { position: 'absolute', right: -8, top: -6, width: 132, height: 128, overflow: 'hidden' },
  mapBlob: { position: 'absolute', right: 8, top: 0, width: 108, height: 118, borderRadius: 54, backgroundColor: '#E7F6EC' },
  pin: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: BUTTON, borderWidth: 2, borderColor: '#FFFFFF', zIndex: 2 },
  rider: { position: 'absolute', width: 150, height: 150, right: -28, top: 18 },
  search: { marginTop: 8, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EEF1F4', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, shadowColor: '#111827', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  searchIcon: { color: '#8B949E', fontSize: 18, marginRight: 8 },
  searchInput: { flex: 1, color: INK, fontSize: 15, paddingVertical: 0 },
  location: { marginTop: 14, borderRadius: 18, backgroundColor: '#F3FBF6', borderWidth: 1, borderColor: '#E3F4EA', paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  locationMark: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: BUTTON, alignItems: 'center', justifyContent: 'center' },
  locationDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: BUTTON },
  locationTitle: { color: INK, fontSize: 15, fontWeight: '800' },
  locationSub: { color: '#6B7280', fontSize: 12, marginTop: 2 },
  chevron: { color: '#9AA3AD', fontSize: 22, fontWeight: '500' },
  note: { color: '#66707A', fontSize: 12, marginTop: 8 },
  sectionHead: { marginTop: 22, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { color: INK, fontSize: 16, fontWeight: '800' },
  link: { color: BUTTON, fontSize: 14, fontWeight: '700' },
  destinations: { gap: 12, paddingRight: 8 },
  destination: { width: 92 },
  destinationPhoto: { width: 92, height: 78, borderRadius: 16, backgroundColor: '#E8EEF2' },
  destinationOn: { borderWidth: 2, borderColor: BUTTON },
  destinationName: { marginTop: 8, color: INK, fontSize: 14, fontWeight: '800' },
  destinationTag: { color: '#7B848E', fontSize: 11, marginTop: 2 },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F1F3F6' },
  recentOn: { backgroundColor: '#F3FBF6', borderRadius: 14, paddingHorizontal: 8, borderTopColor: 'transparent' },
  recentPhoto: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E8EEF2' },
  recentName: { color: INK, fontSize: 15, fontWeight: '800' },
  recentTag: { color: '#7B848E', fontSize: 12, marginTop: 2 },
  empty: { color: '#7B848E', fontSize: 13, paddingVertical: 8 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  backButton: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6E8EC', alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: INK, fontSize: 22, fontWeight: '600', marginTop: -1 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pill: { width: 18, height: 7, borderRadius: 4, backgroundColor: BUTTON },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D5DADF' },
  nextButton: { height: 52, paddingHorizontal: 22, borderRadius: 26, backgroundColor: BUTTON, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  nextText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  nextArrow: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
