import React from 'react';
import { StyleSheet, View } from 'react-native';

const BUTTON = '#07A574';
const STEPS = [1, 2, 3];

export function StepBars({ step, onDark = false }) {
  return <View style={styles.row} accessibilityLabel={`Screen ${step} of 3`}>
    {STEPS.map(number => <View key={number} style={[styles.bar, number === step ? styles.barOn : onDark ? styles.barOffDark : styles.barOff]} />)}
  </View>;
}

export function StepDots({ step, onDark = false }) {
  return <View style={styles.row} accessibilityLabel={`Screen ${step} of 3`}>
    {STEPS.map(number => <View key={number} style={number === step ? styles.pill : onDark ? styles.dotDark : styles.dot} />)}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bar: { height: 5, borderRadius: 3 },
  barOn: { width: 28, backgroundColor: BUTTON },
  barOff: { width: 18, backgroundColor: '#E6E8EC' },
  barOffDark: { width: 18, backgroundColor: 'rgba(255,255,255,0.72)' },
  pill: { width: 18, height: 7, borderRadius: 4, backgroundColor: BUTTON },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D5DADF' },
  dotDark: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.75)' },
});
