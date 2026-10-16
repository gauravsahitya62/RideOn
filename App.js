import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AuthGate from './src/auth/AuthGate';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthGate />
    </SafeAreaProvider>
  );
}
