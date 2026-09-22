import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Set EXPO_PUBLIC_API_URL in your local .env. Android emulator uses 10.0.2.2;
// iOS simulator uses localhost. A physical device needs your computer's LAN IP.
const DEFAULT_API_URL = 'https://rideon-api-262g.onrender.com';
const API_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 20000;
let accessToken = null;
const ACCESS_TOKEN_KEY = 'rideon_access_token';

export const setAccessToken = (token) => { accessToken = token ? String(token) : null; };

export async function restoreAccessToken() {
  try {
    accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  } catch {
    accessToken = null;
  }
  return accessToken;
}

export async function persistAccessToken(token) {
  accessToken = token ? String(token) : null;
  try {
    if (accessToken) await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    else await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  } catch (error) {
    accessToken = null;
    throw new Error('Could not securely store the RideOn session on this device.');
  }
}

export async function clearStoredAccessToken() {
  accessToken = null;
  try { await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY); } catch {}
}

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
  createBooking: (payload, idempotencyKey) => request('/api/v1/bookings', { method: 'POST', headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined, body: JSON.stringify(payload) }),
  getBooking: (id) => request(`/api/v1/bookings/${encode(id)}`),
  cancelBooking: (id) => request(`/api/v1/bookings/${encode(id)}/cancel`, { method: 'PATCH' }),
  requestOtp: (payload) => request('/api/v1/auth/request-otp', { method: 'POST', body: JSON.stringify(payload) }),
  verifyOtp: (payload) => request('/api/v1/auth/verify-otp', { method: 'POST', body: JSON.stringify(payload) }),
  register: (payload) => request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => request('/api/v1/me'),
  updateMe: (payload) => request('/api/v1/me', { method:'PATCH', body:JSON.stringify(payload) }),
  listAddresses: () => request('/api/v1/me/addresses'),
  createAddress: (payload) => request('/api/v1/me/addresses', { method:'POST', body:JSON.stringify(payload) }),
  updateAddress: (id,payload) => request(`/api/v1/me/addresses/${encode(id)}`, { method:'PATCH', body:JSON.stringify(payload) }),
  deleteAddress: (id) => request(`/api/v1/me/addresses/${encode(id)}`, { method:'DELETE' }),
  vendorMe: () => request('/api/v1/vendor/me'),
  listVendorVehicles: () => request('/api/v1/vendor/vehicles'),
  createVendorVehicle: (payload) => request('/api/v1/vendor/vehicles', { method:'POST', body:JSON.stringify(payload) }),
  listVendorBookings: () => request('/api/v1/vendor/bookings'),
  updateVendorBookingStatus: (id,status) => request(`/api/v1/vendor/bookings/${encode(id)}/status`, { method:'PATCH', body:JSON.stringify({status}) }),
  listBookings: (params = {}) => { const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString(); return request(`/api/v1/bookings${query ? `?${query}` : ''}`); },
};
