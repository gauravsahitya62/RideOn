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
  listMapVendors: (params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
    return request(`/api/v1/vendors/map${query ? `?${query}` : ''}`);
  },
  getRouteEta: (vendorId, latitude, longitude) => request(`/api/v1/routing/eta?vendorId=${encode(vendorId)}&latitude=${encode(latitude)}&longitude=${encode(longitude)}`),
  geocodeAddress: (address, city) => {
    const query = new URLSearchParams({ address: String(address || ''), ...(city ? { city: String(city) } : {}) }).toString();
    return request(`/api/v1/geocoding/search?${query}`);
  },
  getVendorServiceLocation: () => request('/api/v1/vendor/service-location'),
  updateVendorServiceLocation: (payload) => request('/api/v1/vendor/service-location', { method:'PATCH', body:JSON.stringify(payload) }),
  updateBookingRoute: (bookingId) => request(`/api/v1/bookings/${encode(bookingId)}/route`, { method:'POST', body: JSON.stringify({}) }),
  getTracking: (bookingId) => request(`/api/v1/bookings/${encode(bookingId)}/tracking`),
  startDelivery: (bookingId) => request(`/api/v1/vendor/bookings/${encode(bookingId)}/delivery/start`, { method:'POST', body:JSON.stringify({}) }),
  updateDeliveryLocation: (bookingId,payload) => request(`/api/v1/vendor/bookings/${encode(bookingId)}/delivery/location`, { method:'POST', body:JSON.stringify(payload) }),
  completeDelivery: (bookingId,payload={}) => request(`/api/v1/vendor/bookings/${encode(bookingId)}/delivery/complete`, { method:'POST', body:JSON.stringify(payload) }),
  abortDelivery: (bookingId) => request(`/api/v1/vendor/bookings/${encode(bookingId)}/delivery/abort`, { method:'POST', body:JSON.stringify({}) }),
  createTrackingSocket: (bookingId, handlers = {}) => {
    if (!accessToken) throw new Error('RideOn session expired. Please sign in again.');
    const wsBase = API_URL.replace(/^http/i, 'ws');
    const socket = new WebSocket(`${wsBase}/ws/tracking/${encode(bookingId)}`, [`rideon-auth.${accessToken}`, 'rideon-tracking']);
    if (handlers.onOpen) socket.onopen = handlers.onOpen;
    if (handlers.onMessage) socket.onmessage = handlers.onMessage;
    if (handlers.onClose) socket.onclose = handlers.onClose;
    if (handlers.onError) socket.onerror = handlers.onError;
    return socket;
  },
  getPublicVendor: (vendorId) => request(`/api/v1/vendors/${encode(vendorId)}`),
  listPublicVendorVehicles: (vendorId,params={}) => {
    const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='')).toString();
    return request(`/api/v1/vendors/${encode(vendorId)}/vehicles${query?`?${query}`:''}`);
  },
  quoteMultiVehicle: (payload) => request('/api/v1/quotes/multi', { method:'POST', body:JSON.stringify(payload) }),
  pricingPreview: (payload) => request('/api/v1/pricing/preview', { method:'POST', body:JSON.stringify(payload) }),
  createVehicleReservation: (payload,idempotencyKey) => request('/api/v1/reservations', { method:'POST', headers:idempotencyKey?{'Idempotency-Key':idempotencyKey}:undefined, body:JSON.stringify(payload) }),
  releaseVehicleReservation: (reservationId) => request(`/api/v1/reservations/${encode(reservationId)}/release`, { method:'POST', body:JSON.stringify({}) }),
  createFleetOrder: (payload,idempotencyKey) => request('/api/v1/fleet-orders', { method:'POST', headers:idempotencyKey?{'Idempotency-Key':idempotencyKey}:undefined, body:JSON.stringify(payload) }),
  getFleetOrder: (id) => request(`/api/v1/fleet-orders/${encode(id)}`),
  listFleetOrders: (params={}) => { const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='')).toString(); return request(`/api/v1/fleet-orders${query?`?${query}`:''}`); },
  requestRentalReturn: (bookingId,payload={}) => request(`/api/v1/bookings/${encode(bookingId)}/return-request`, { method:'POST', body:JSON.stringify(payload) }),
  getBookingTracking: (bookingId) => request(`/api/v1/bookings/${encode(bookingId)}/tracking`),
  createFleetOpsHandover: (bookingId,payload) => request(`/api/v1/fleet-ops/bookings/${encode(bookingId)}/handover`, { method:'POST', body:JSON.stringify(payload) }),
  createFleetOpsReturn: (bookingId,payload) => request(`/api/v1/fleet-ops/bookings/${encode(bookingId)}/return`, { method:'POST', body:JSON.stringify(payload) }),
  createFleetOpsInspection: (vehicleId,payload) => request(`/api/v1/fleet-ops/vehicles/${encode(vehicleId)}/inspection`, { method:'POST', body:JSON.stringify(payload) }),
  settleFleetDeposit: (bookingId,payload) => request(`/api/v1/fleet-ops/bookings/${encode(bookingId)}/deposit/settle`, { method:'POST', body:JSON.stringify(payload) }),
  getFleetOpsDashboard: () => request('/api/v1/fleet-ops/dashboard'),
  getFleetOpsBookings: () => request('/api/v1/fleet-ops/bookings'),
  listFleetDamageCases: (params={}) => { const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='')).toString(); return request(`/api/v1/fleet-ops/damage-cases${query?`?${query}`:''}`); },
  updateFleetDamageCase: (caseId,payload) => request(`/api/v1/fleet-ops/damage-cases/${encode(caseId)}`, { method:'PATCH', body:JSON.stringify(payload) }),
  confirmFleetDepositSettlement: (settlementId,payload) => request(`/api/v1/fleet-ops/deposit-settlements/${encode(settlementId)}/confirm`, { method:'POST', body:JSON.stringify(payload) }),
  createFleetOrderPayment: (id,idempotencyKey) => request(`/api/v1/fleet-orders/${encode(id)}/payment`, { method:'POST', headers:idempotencyKey?{'Idempotency-Key':idempotencyKey}:undefined, body:JSON.stringify({idempotencyKey}) }),
  listVendorFleetOrders: (params={}) => { const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='')).toString(); return request(`/api/v1/vendor/fleet-orders${query?`?${query}`:''}`); },
  getVendorFleetOrder: (id) => request(`/api/v1/vendor/fleet-orders/${encode(id)}`),
  updateVendorFleetOrderStatus: (id,payload) => request(`/api/v1/vendor/fleet-orders/${encode(id)}/status`, { method:'PATCH', body:JSON.stringify(payload) }),

  listFleet: (params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
    return request(`/api/v1/fleet${query ? `?${query}` : ''}`);
  },
  getFleetVehicle: (id) => request(`/api/v1/fleet/${encode(id)}`),
  fleetAvailability: (id, params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
    return request(`/api/v1/fleet/${encode(id)}/availability${query ? `?${query}` : ''}`);
  },
  multiQuote: (payload) => request('/api/v1/quotes/multi', { method:'POST', body:JSON.stringify(payload) }),
  createFleetOrder: (payload,idempotencyKey) => request('/api/v1/fleet-orders', { method:'POST', headers:idempotencyKey?{'Idempotency-Key':idempotencyKey}:undefined, body:JSON.stringify(payload) }),
  getFleetOrder: (id) => request(`/api/v1/fleet-orders/${encode(id)}`),
  listFleetOrders: (params={}) => { const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='')).toString(); return request(`/api/v1/fleet-orders${query?`?${query}`:''}`); },
  createFleetPayment: (orderId,payload={}) => request(`/api/v1/fleet-orders/${encode(orderId)}/payment`, { method:'POST', body:JSON.stringify(payload) }),
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
  createSupportTicket: (payload, idempotencyKey) => request('/api/v1/support/tickets', { method:'POST', headers:idempotencyKey ? {'Idempotency-Key':idempotencyKey} : undefined, body:JSON.stringify(payload) }),
  listSupportTickets: (params={}) => { const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='')).toString(); return request(`/api/v1/support/tickets${query?`?${query}`:''}`); },
  getSupportTicket: (ticketId) => request(`/api/v1/support/tickets/${encode(ticketId)}`),
  getSupportMessages: (ticketId) => request(`/api/v1/support/tickets/${encode(ticketId)}/messages`),
  addSupportMessage: (ticketId,message) => request(`/api/v1/support/tickets/${encode(ticketId)}/messages`, { method:'POST', body:JSON.stringify({message}) }),
  closeSupportTicket: (ticketId) => request(`/api/v1/support/tickets/${encode(ticketId)}/close`, { method:'POST', body:JSON.stringify({}) }),
  reopenSupportTicket: (ticketId) => request(`/api/v1/support/tickets/${encode(ticketId)}/reopen`, { method:'POST', body:JSON.stringify({}) }),
  getReviewStatus: (bookingId) => request(`/api/v1/bookings/${encode(bookingId)}/reviews/status`),
  createCustomerReview: (bookingId,payload) => request(`/api/v1/bookings/${encode(bookingId)}/reviews/customer`, { method:'POST', body:JSON.stringify(payload) }),
  createVendorReview: (bookingId,payload) => request(`/api/v1/vendor/bookings/${encode(bookingId)}/review`, { method:'POST', body:JSON.stringify(payload) }),
  updateReview: (reviewId,payload) => request(`/api/v1/reviews/${encode(reviewId)}`, { method:'PATCH', body:JSON.stringify(payload) }),
  getVehicleReviews: (vehicleId,params={}) => { const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='')).toString(); return request(`/api/v1/vehicles/${encode(vehicleId)}/reviews${query?`?${query}`:''}`); },
  getVendorReviews: (vendorId,params={}) => { const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='')).toString(); return request(`/api/v1/vendors/${encode(vendorId)}/reviews${query?`?${query}`:''}`); },
  getMyReviews: (params={}) => { const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='')).toString(); return request(`/api/v1/me/reviews${query?`?${query}`:''}`); },
  getCancellationPreview: (id) => request(`/api/v1/bookings/${encode(id)}/cancellation-preview`),
  cancelBooking: (id, payload = {}) => request(`/api/v1/bookings/${encode(id)}/cancel`, { method: 'PATCH', body: JSON.stringify(payload) }),
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
  uploadVehicleImage: async ({ base64, contentType = 'image/jpeg' } = {}) => {
    if (!accessToken) throw new Error('Vendor session expired. Please sign in again.');
    if (!base64) throw new Error('No image data was selected.');
    const requestId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const response = await fetch(`${API_URL}/api/v1/vendor/vehicle-images`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, contentType }),
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
  getVendorCustomerReviews: (bookingId) => request(`/api/v1/vendor/bookings/${encode(bookingId)}/customer-reviews`),
  updateVendorBookingStatus: (id,payload) => request(`/api/v1/vendor/bookings/${encode(id)}/status`, { method:'PATCH', body:JSON.stringify(payload) }),
  getPaymentCapabilities: () => request('/api/v1/payments/capabilities'),
  createPaymentOrder: (payload) => request('/api/v1/payments/create-order', { method:'POST', body:JSON.stringify(payload) }),
  getPayment: (id) => request(`/api/v1/payments/${encode(id)}`),
  getPaymentByBooking: async (bookingId) => {
    const result = await request(`/api/v1/bookings/${encode(bookingId)}`);
    const paymentId = result?.booking?.paymentId || result?.booking?.payment?.id;
    return paymentId ? request(`/api/v1/payments/${encode(paymentId)}`) : null;
  },
  verifyPayment: (id,payload = {}) => request(`/api/v1/payments/${encode(id)}/verify`, { method:'POST', body:JSON.stringify({ bookingId: payload.bookingId }) }),
  inspectSecurityDeposit: (bookingId,payload = {}) => request(`/api/v1/vendor/bookings/${encode(bookingId)}/security-deposit/inspection`, { method:'POST', body:JSON.stringify(payload) }),
  listBookings: (params = {}) => { const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString(); return request(`/api/v1/bookings${query ? `?${query}` : ''}`); },
};
