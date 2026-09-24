import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Set EXPO_PUBLIC_API_URL in your local .env. Android emulator uses 10.0.2.2;
// iOS simulator uses localhost. A physical device needs your computer's LAN IP.
// EXPO_PUBLIC_API_URL overrides this. The hosted API fallback keeps physical iOS devices and production builds off localhost/emulator-only addresses.
const DEFAULT_API_URL = 'https://rideon-api-262g.onrender.com';
const configuredApiUrl = String(process.env.EXPO_PUBLIC_API_URL || '').trim();
const explicitLocalApi = process.env.EXPO_PUBLIC_USE_LOCAL_API === 'true';
const isLocalApiUrl = (() => {
  if (!configuredApiUrl) return false;
  try {
    const host = new URL(configuredApiUrl).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '10.0.2.2' || /^192\\.168\\./.test(host) || /^10\\./.test(host);
  } catch {
    return false;
  }
})();

// Expo Go on a physical iPhone must not use localhost: that resolves to the phone itself.
// Hosted Render is the safe default. Local development is opt-in with EXPO_PUBLIC_USE_LOCAL_API=true.
const API_URL = (explicitLocalApi && configuredApiUrl ? configuredApiUrl : DEFAULT_API_URL).replace(/\/+$/, '');
console.log('[RideOnAPI] configured:', configuredApiUrl || '(none)');
console.log('[RideOnAPI] resolved:', API_URL);
console.log('[RideOnAPI] localOverride:', explicitLocalApi && isLocalApiUrl);
console.log('[RideOnAPI] mode:', process.env.EXPO_PUBLIC_API_URL ? 'explicit' : 'hosted-default');
console.log('[RideOnAPI] platform:', Platform.OS);
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
  const requestId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const method = options.method || 'GET';
  const url = `${API_URL}${path}`;
  const startedAt = Date.now();
  console.log('[RideOnNetwork][REQUEST]', JSON.stringify({ requestId, method, url, hasAuthToken: Boolean(accessToken) }));
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeoutId;
  let response;
  try {
    if (controller) timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    response = await fetch(url, {
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
    console.error('[RideOnNetwork][FETCH_ERROR]', JSON.stringify({ requestId, method, url, elapsedMs: Date.now() - startedAt, name: error?.name, message: error?.message }));
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
  console.log('[RideOnNetwork][RESPONSE]', JSON.stringify({ requestId, method, url, status: response.status, ok: response.ok, elapsedMs: Date.now() - startedAt, errorCode: payload?.error?.code || null }));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || payload?.error?.code || `Request failed (${response.status})`;
    const error = new Error(`${String(message)} [${response.status} ${path}]`);
    error.code = payload?.error?.code || null;
    error.status = response.status;
    error.path = path;
    error.details = payload?.error?.details;
    console.error('[RideOnNetwork][HTTP_ERROR]', JSON.stringify({ requestId, method, url, status: response.status, path, errorCode: error.code, message: error.message, response: payload?.error || payload?.message || null }));
    throw error;
  }
  console.log('[RideOnNetwork][SUCCESS]', JSON.stringify({ requestId, method, path, status: response.status }));
  return payload;
}

const encode = (value) => encodeURIComponent(String(value));

export const rideOnApi = {
  health: () => request('/health'),
  listLocations: () => request('/api/v1/locations'),
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
  completeRegistration: (payload) => request('/api/v1/auth/complete-registration', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => request('/api/v1/me'),
  register: (payload) => request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  vendorMe: () => request('/api/v1/vendor/me'),
  updateVendorMe: (payload) => request('/api/v1/vendor/me', { method:'PATCH', body:JSON.stringify(payload) }),
  listVendorVehicles: (params = {}) => { const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString(); return request(`/api/v1/vendor/vehicles${query ? `?${query}` : ''}`); },
  createVendorVehicle: (payload) => request('/api/v1/vendor/vehicles', { method:'POST', body:JSON.stringify(payload) }),
  uploadVehicleImage: async (uri) => {
    if (!accessToken) throw new Error('Vendor session expired. Please sign in again.');
    const requestId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const response = await fetch(`${API_URL}/api/v1/vendor/vehicle-images`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/jpeg' },
      body: await (await fetch(uri)).blob(),
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const message = payload?.error?.message || 'Vehicle image upload failed.';
      const error = new Error(`${message} [${response.status} /api/v1/vendor/vehicle-images]`);
      error.code = payload?.error?.code || null; error.status = response.status; error.path = '/api/v1/vendor/vehicle-images';
      console.error('[RideOnNetwork][UPLOAD_ERROR]', JSON.stringify({requestId,status:response.status,errorCode:error.code,message}));
      throw error;
    }
    return payload;
  },

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
