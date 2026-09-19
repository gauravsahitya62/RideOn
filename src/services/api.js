import { Platform } from 'react-native';

// Set EXPO_PUBLIC_API_URL in your local .env. Android emulator uses 10.0.2.2;
// iOS simulator uses localhost. A physical device needs your computer's LAN IP.
const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
const API_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, '');

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(`RideOn API is unreachable at ${API_URL}. Start the server and check EXPO_PUBLIC_API_URL.`);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error?.code || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

const encode = (value) => encodeURIComponent(String(value));

export const rideOnApi = {
  health: () => request('/health'),
  listVehicles: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value != null && value !== '')
    ).toString();
    return request(`/api/v1/vehicles${query ? `?${query}` : ''}`);
  },
  getVehicle: (id) => request(`/api/v1/vehicles/${encode(id)}`),
  quote: (payload) => request('/api/v1/bookings/quote', { method: 'POST', body: JSON.stringify(payload) }),
  createBooking: (payload) => request('/api/v1/bookings', { method: 'POST', body: JSON.stringify(payload) }),
  getBooking: (id) => request(`/api/v1/bookings/${encode(id)}`),
  cancelBooking: (id) => request(`/api/v1/bookings/${encode(id)}/cancel`, { method: 'PATCH' }),
};
