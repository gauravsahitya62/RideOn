import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Set EXPO_PUBLIC_API_URL in your local .env. Android emulator uses 10.0.2.2;
// iOS simulator uses localhost. A physical device needs your computer's LAN IP.
// EXPO_PUBLIC_API_URL overrides this. The hosted API fallback keeps physical iOS devices and production builds off localhost/emulator-only addresses.
const DEFAULT_API_URL = 'https://rideon-api.onrender.com';
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL || 'https://rideon-api.onrender.com';
if (!configuredApiUrl) throw new Error('EXPO_PUBLIC_API_URL must be configured for non-development builds.');
const API_URL = configuredApiUrl.replace(/\/$/, '');
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
    const error = new Error(String(message));
    error.code = payload?.error?.code || null;
    error.status = response.status;
    error.details = payload?.error?.details;
    throw error;
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
  availability: (id, params = {}) => { const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString(); return request(`/api/v1/vehicles/${encode(id)}/availability${query ? `?${query}` : ''}`); },
  quote: (payload) => request('/api/v1/bookings/quote', { method: 'POST', body: JSON.stringify(payload) }),
  createBooking: (payload, idempotencyKey) => request('/api/v1/bookings', { method: 'POST', headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined, body: JSON.stringify(payload) }),
  getBooking: (id) => request(`/api/v1/bookings/${encode(id)}`),
  cancelBooking: (id) => request(`/api/v1/bookings/${encode(id)}/cancel`, { method: 'PATCH' }),
  requestOtp: (payload) => request('/api/v1/auth/request-otp', { method: 'POST', body: JSON.stringify(payload) }),
  verifyOtp: (payload) => request('/api/v1/auth/verify-otp', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => request('/api/v1/me'),
  register: (payload) => request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  vendorMe: () => request('/api/v1/vendor/me'),
  updateVendorMe: (payload) => request('/api/v1/vendor/me', { method:'PATCH', body:JSON.stringify(payload) }),
  listVendorVehicles: (params = {}) => { const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString(); return request(`/api/v1/vendor/vehicles${query ? `?${query}` : ''}`); },
  createVendorVehicle: (payload) => request('/api/v1/vendor/vehicles', { method:'POST', body:JSON.stringify(payload) }),
  getVendorVehicle: (id) => request(`/api/v1/vendor/vehicles/${encode(id)}`),
  updateVendorVehicle: (id,payload) => request(`/api/v1/vendor/vehicles/${encode(id)}`, { method:'PATCH', body:JSON.stringify(payload) }),
  deleteVendorVehicle: (id) => request(`/api/v1/vendor/vehicles/${encode(id)}`, { method:'DELETE' }),
  listVendorBookings: (params = {}) => { const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString(); return request(`/api/v1/vendor/bookings${query ? `?${query}` : ''}`); },
  getVendorBooking: (id) => request(`/api/v1/vendor/bookings/${encode(id)}`),
  updateVendorBookingStatus: (id,payload) => request(`/api/v1/vendor/bookings/${encode(id)}/status`, { method:'PATCH', body:JSON.stringify(payload) }),
  createPaymentOrder: (payload) => request('/api/v1/payments/create-order', { method:'POST', body:JSON.stringify(payload) }),
  getPayment: (id) => request(`/api/v1/payments/${encode(id)}`),
  getPaymentByBooking: async (bookingId) => {
    const result = await request(`/api/v1/bookings/${encode(bookingId)}`);
    const paymentId = result?.booking?.paymentId || result?.booking?.payment?.id;
    return paymentId ? request(`/api/v1/payments/${encode(paymentId)}`) : null;
  },
  verifyPayment: (id,payload) => request(`/api/v1/payments/${encode(id)}/verify`, { method:'POST', body:JSON.stringify(payload) }),
  listBookings: (params = {}) => { const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString(); return request(`/api/v1/bookings${query ? `?${query}` : ''}`); },
};
