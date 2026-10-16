import React from 'react';
import { Text, View } from 'react-native';

export const PROVIDER_GOOGLE = 'google';

export const Marker = React.forwardRef(function Marker(_props, ref) {
  React.useImperativeHandle(ref, () => ({ __rideOnCoordinate: null }));
  return null;
});

export function Polyline() {
  return null;
}

export class AnimatedRegion {
  constructor(value) {
    this.value = value;
  }

  timing() {
    return { start(callback) { if (callback) callback({ finished: true }); } };
  }
}

export default function MapView({ style, children }) {
  return (
    <View style={[{ minHeight: 160, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8EEF2' }, style]}>
      <Text style={{ color: '#17202D', fontSize: 13 }}>Map is available in the mobile app.</Text>
      {children}
    </View>
  );
}
