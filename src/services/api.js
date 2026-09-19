import { Platform } from 'react-native';

// Set EXPO_PUBLIC_API_URL in your local .env. Android emulator uses 10.0.2.2;
// iOS simulator uses localhost. A physical device needs your computer's LAN IP.
const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
const API_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 20000;
let accessToken = null;
export const setAccessToken = (token) => { accessToken = token ? String(token) : null; };

async function request(path, options = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeoutId;
  let response;
  try {
    if (controller) timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      ...(controller ? { signal: controller.signal } : {}),
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`RideOn API request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. Check your connection and retry.`);
    }
    throw new Error(`RideOn API is unreachable at ${API_URL}. Start the server and check EXPO_PUBLIC_API_URL.`);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || payload?.error?.code || `Request failed (${response.status})`;
    throw new Error(String(message));
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
  register: (payload) => request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  listBookings: (params = {}) => { const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString(); return request(`/api/v1/bookings${query ? `?${query}` : ''}`); },
};
