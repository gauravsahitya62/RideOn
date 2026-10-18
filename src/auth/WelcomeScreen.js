import React from 'react';
import { ImageBackground, StatusBar, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GREEN = '#026342';
const BUTTON = '#07A574';
const INK = '#17181C';
const photo = require('../../assets/splash-scene.jpg');

export default function WelcomeScreen({ onDone }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const brandTop = Math.max(insets.top + 18, height * 0.1);
  const headlineTop = height * 0.25;
  const featuresTop = Math.min(height * 0.4, height * 0.53 - 108) + 8;

  return <ImageBackground source={photo} style={styles.photo} resizeMode="cover">
    <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
    <View style={styles.page}>
      <View style={[styles.brandBlock, { top: brandTop }]}>
        <Text style={styles.brand}>Ride<Text style={styles.brandOn}>On</Text></Text>
        <Text style={styles.tagline}>Rent. Ride. Explore.</Text>
      </View>

      <View style={[styles.copyBlock, { top: headlineTop }]}>
        <Text style={styles.headline}>Bike & Scooter Rentals{'\n'}Across India</Text>
        <Text style={styles.sub}>Your ride for every journey,{'\n'}in every city.</Text>
      </View>

      <View style={[styles.features, { top: featuresTop }]}>
        <Feature icon={<ScooterMark />} label={'Wide Range\nof Bikes & Scooters'} />
        <Feature icon={<CalendarMark />} label={'Flexible Rentals\nHourly, Daily, Weekly'} />
        <Feature icon={<ShieldMark />} label={'Safe, Reliable\n& Well Maintained'} />
      </View>

      <View style={[styles.footer, { bottom: Math.max(insets.bottom, 10) + 6 }]}>
        <TouchableOpacity style={styles.button} onPress={onDone} accessibilityRole="button" accessibilityLabel="Get Started">
          <Text style={styles.buttonText}>Get Started</Text>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>
        <View style={styles.dots}>
          <View style={styles.pill} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
      </View>
    </View>
  </ImageBackground>;
}

function Feature({ icon, label }) {
  return <View style={styles.feature}>
    <View style={styles.circle}>{icon}</View>
    <Text style={styles.featureLabel}>{label}</Text>
  </View>;
}

function ScooterMark() {
  return <View style={styles.scooter}>
    <View style={styles.scooterBar} />
    <View style={styles.scooterBody} />
    <View style={[styles.wheel, styles.wheelLeft]} />
    <View style={[styles.wheel, styles.wheelRight]} />
  </View>;
}

function CalendarMark() {
  return <View style={styles.calendar}>
    <View style={styles.calendarTop} />
    <View style={[styles.calendarPin, { left: 4 }]} />
    <View style={[styles.calendarPin, { right: 4 }]} />
    <View style={styles.calendarGrid}>
      <View style={styles.calendarDot} />
      <View style={styles.calendarDot} />
      <View style={styles.calendarDot} />
      <View style={styles.calendarDot} />
    </View>
  </View>;
}

function ShieldMark() {
  return <View style={styles.shield}><Text style={styles.shieldTick}>✓</Text></View>;
}

const styles = StyleSheet.create({
  photo: { flex: 1, backgroundColor: '#C9DFF3' },
  page: { flex: 1 },
  brandBlock: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  brand: { textAlign: 'center', color: INK, fontSize: 48, lineHeight: 52, fontWeight: '800', letterSpacing: -1.6 },
  brandOn: { color: GREEN, fontSize: 48, lineHeight: 52, fontWeight: '800', letterSpacing: -1.6 },
  tagline: { textAlign: 'center', color: INK, fontSize: 16, lineHeight: 22, fontWeight: '700', marginTop: 4 },
  copyBlock: { position: 'absolute', left: 24, right: 24, alignItems: 'center' },
  headline: { textAlign: 'center', color: INK, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.4 },
  sub: { textAlign: 'center', color: '#2A3136', fontSize: 16, lineHeight: 22, fontStyle: 'italic', fontWeight: '500', marginTop: 10 },
  features: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  feature: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  circle: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#E3F8DE', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  featureLabel: { textAlign: 'center', color: INK, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  footer: { position: 'absolute', left: 22, right: 22 },
  button: { height: 56, borderRadius: 28, backgroundColor: BUTTON, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  arrow: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginTop: -1 },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.75)' },
  pill: { width: 18, height: 6, borderRadius: 3, backgroundColor: BUTTON },
  scooter: { width: 28, height: 22 },
  scooterBar: { position: 'absolute', left: 15, top: 1, width: 8, height: 9, borderLeftWidth: 1.8, borderBottomWidth: 1.8, borderColor: GREEN, borderBottomLeftRadius: 2, transform: [{ rotate: '-28deg' }] },
  scooterBody: { position: 'absolute', left: 5, top: 8, width: 15, height: 7, borderWidth: 1.8, borderColor: GREEN, borderRadius: 4 },
  wheel: { position: 'absolute', top: 13, width: 8, height: 8, borderRadius: 4, borderWidth: 1.8, borderColor: GREEN },
  wheelLeft: { left: 1 },
  wheelRight: { left: 17 },
  calendar: { width: 22, height: 22, borderRadius: 4, borderWidth: 1.7, borderColor: GREEN, overflow: 'hidden' },
  calendarTop: { height: 6, backgroundColor: GREEN },
  calendarPin: { position: 'absolute', top: -2, width: 2, height: 5, borderRadius: 1, backgroundColor: GREEN },
  calendarGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center', gap: 3, paddingTop: 2 },
  calendarDot: { width: 3, height: 3, borderRadius: 1, backgroundColor: GREEN },
  shield: { width: 20, height: 23, borderWidth: 1.8, borderColor: GREEN, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, alignItems: 'center', justifyContent: 'center' },
  shieldTick: { color: GREEN, fontSize: 12, fontWeight: '800', marginTop: -1 },
});
