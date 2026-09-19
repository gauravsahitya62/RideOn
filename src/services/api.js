import { Platform } from 'react-native';

// Set EXPO_PUBLIC_API_URL in your local .env. For Android emulator use
// http://10.0.2.2:4000; for iOS simulator use http://localhost:4000;
// physical devices must use your development machine's LAN IP.
const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
const API_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, '');

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
  } catch (error) {
    throw new Error(`RideOn API is unreachable at ${API_URL}. Check that the server is running and EXPO_PUBLIC_API_URL is correct.`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export const rideOnApi = {
  health: () => request('/health'),
  listVehicles: (params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
    return request(`/api/vehicles${query ? `?${query}` : ''}`);
  },
  getVehicle: (id) => request(`/api/vehicles/${encodeURIComponent(id)}`),
  quote: (payload) => request('/api/quote', { method: 'POST', body: JSON.stringify(payload) }),
  createBooking: (payload) => request('/api/bookings', { method: 'POST', body: JSON.stringify(payload) }),
  getBooking: (id) => request(`/api/bookings/${encodeURIComponent(id)}`),
  cancelBooking: (id) => request(`/api/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
};
