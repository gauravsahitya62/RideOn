import React, { useState } from 'react';
import { ImageBackground, StatusBar, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CityScreen from './CityScreen';
import { StepBars, StepDots } from './OnboardingSteps';

const GREEN = '#026342';
const BUTTON = '#07A574';
const INK = '#17181C';
const photo = require('../../assets/splash-scene.jpg');
const ridePhoto = require('../../assets/welcome-ride.jpg');

export default function WelcomeScreen({ onDone }) {
  const [step, setStep] = useState(0);
  if (step === 2) return <CityScreen onBack={() => setStep(1)} onDone={onDone} />;
  if (step === 1) return <ExploreScreen onBack={() => setStep(0)} onNext={() => setStep(2)} onDone={onDone} />;
  return <SplashScreen onNext={() => setStep(1)} />;
}

function SplashScreen({ onNext }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const brandTop = Math.max(insets.top + 18, height * 0.1);
  const headlineTop = height * 0.25;
  const featuresTop = Math.min(height * 0.4, height * 0.53 - 108) + 8;

  return <ImageBackground source={photo} style={styles.photo} resizeMode="cover">
    <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
    <View style={styles.page}>
      <View style={[styles.splashSteps, { top: insets.top + 8 }]}><StepBars step={1} onDark /></View>
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
        <TouchableOpacity style={styles.button} onPress={onNext} accessibilityRole="button" accessibilityLabel="Get Started">
          <Text style={styles.buttonText}>Get Started</Text>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>
        <View style={styles.dots}><StepDots step={1} onDark /></View>
      </View>
    </View>
  </ImageBackground>;
}

function ExploreScreen({ onBack, onNext, onDone }) {
  const insets = useSafeAreaInsets();
  return <ImageBackground source={ridePhoto} style={styles.photo} resizeMode="cover">
    <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
    <View style={[styles.explore, { paddingTop: insets.top + 10, paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
      <View style={styles.exploreTop}>
        <StepBars step={2} />
        <TouchableOpacity onPress={onDone} accessibilityRole="button" hitSlop={12}>
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.exploreTitle}>Explore{'\n'}Ride{'\n'}<Text style={styles.exploreTitleGreen}>Discover</Text></Text>
      <Text style={styles.exploreSub}>Bikes & scooters wherever{'\n'}you go in India.</Text>

      <View style={styles.exploreSpacer} />

      <View style={styles.card}>
        <CardFeature icon={<ScooterMark />} title="Wide Range" body={'Bikes & scooters\nin 100+ cities'} />
        <View style={styles.cardRule} />
        <CardFeature icon={<CalendarMark />} title="Flexible Rentals" body={'Hourly, Daily,\nWeekly'} />
        <View style={styles.cardRule} />
        <CardFeature icon={<ShieldMark />} title="Safe & Reliable" body={'Verified vehicles\nand quality service'} />
      </View>

      <View style={styles.exploreNav}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <StepDots step={2} />
        <TouchableOpacity style={styles.nextButton} onPress={onNext} accessibilityRole="button" accessibilityLabel="Next">
          <Text style={styles.nextText}>Next</Text>
          <Text style={styles.nextArrow}>→</Text>
        </TouchableOpacity>
      </View>
    </View>
  </ImageBackground>;
}

function CardFeature({ icon, title, body }) {
  return <View style={styles.cardFeature}>
    <View style={styles.cardCircle}>{icon}</View>
    <Text style={styles.cardTitle}>{title}</Text>
    <Text style={styles.cardBody}>{body}</Text>
  </View>;
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
  splashSteps: { position: 'absolute', left: 24, zIndex: 2 },
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
  explore: { flex: 1, paddingHorizontal: 22 },
  exploreTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  progressOn: { width: 28, height: 5, borderRadius: 3, backgroundColor: BUTTON },
  progressOff: { width: 52, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.72)' },
  skip: { color: INK, fontSize: 16, fontWeight: '600' },
  exploreTitle: { marginTop: 28, color: INK, fontSize: 44, lineHeight: 48, fontWeight: '800', letterSpacing: -1.1 },
  exploreTitleGreen: { color: GREEN, fontSize: 44, lineHeight: 48, fontWeight: '800', letterSpacing: -1.1 },
  exploreSub: { marginTop: 12, color: '#2C343A', fontSize: 17, lineHeight: 23, fontWeight: '500' },
  exploreSpacer: { flex: 1 },
  card: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#FFFFFF', borderRadius: 26, paddingVertical: 18, paddingHorizontal: 8, shadowColor: '#111827', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  cardFeature: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  cardCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#E7F8E8', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  cardTitle: { textAlign: 'center', color: INK, fontSize: 13, lineHeight: 17, fontWeight: '800' },
  cardBody: { textAlign: 'center', color: '#66707A', fontSize: 11, lineHeight: 15, marginTop: 4 },
  cardRule: { width: 1, alignSelf: 'stretch', backgroundColor: '#ECEFF3', marginVertical: 8 },
  exploreNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  backButton: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6E8EC', alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: INK, fontSize: 22, fontWeight: '600', marginTop: -1 },
  exploreDots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  exploreDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D5DADF' },
  explorePill: { width: 18, height: 7, borderRadius: 4, backgroundColor: BUTTON },
  nextButton: { height: 52, paddingHorizontal: 22, borderRadius: 26, backgroundColor: BUTTON, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  nextText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  nextArrow: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
