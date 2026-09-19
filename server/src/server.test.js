import test from 'node:test';
test('concurrent requests using the same idempotency key replay the same booking', async () => {
  const a = await register('+911234567884', 'Concurrent Idempotency User');
  const payload = {
    vehicleId: 'baleno-01',
    startDate: '2033-03-01',
    durationDays: 1,
    delivery: false,
    address: '111 Concurrent Road, Jaipur',
  };
  const [first, second] = await Promise.all([
    jsonRequest('/api/v1/bookings', 'POST', payload, a.accessToken, { 'Idempotency-Key': 'same-concurrent-key' }),
    jsonRequest('/api/v1/bookings', 'POST', payload, a.accessToken, { 'Idempotency-Key': 'same-concurrent-key' }),
  ]);
  const statuses = [first.status, second.status].sort();
  const firstPayload = await first.json();
  const secondPayload = await second.json();
  assert.deepEqual(statuses, [200, 201]);
  assert.equal(firstPayload.booking.bookingId, secondPayload.booking.bookingId);
});


test('vehicle list preserves existing aliases and search contract', async () => {
  const response = await request('/api/v1/vehicles?q=CRETA');
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].id, 'creta-01');
  assert.equal(payload.data[0].price, payload.data[0].pricePerDay);
});

test('protected booking routes reject anonymous callers', async () => {
  const response = await request('/api/v1/bookings');
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error.code, 'AUTH_REQUIRED');
});

test('registration hashes credentials and login returns a bearer token', async () => {
  const registered = await register('+911234567891', 'Auth User');
  assert.ok(registered.accessToken);
  const login = await jsonRequest('/api/v1/auth/login', 'POST', {
    phone: '+911234567891',
    password: 'StrongPass123!',
  });
  const payload = await login.json();
  assert.equal(login.status, 200);
  assert.ok(payload.accessToken);
});

test('login rejects incorrect passwords', async () => {
  await register('+911234567892', 'Wrong Password User');
  const response = await jsonRequest('/api/v1/auth/login', 'POST', {
    phone: '+911234567892',
    password: 'wrong-password',
  });
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error.code, 'INVALID_CREDENTIALS');
});

test('customer can create, list, read, and cancel only own bookings', async () => {
  const a = await register('+911234567893', 'Customer A');
  const b = await register('+911234567894', 'Customer B');
  const bookingResponse = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'creta-01',
    durationDays: 1,
    startDate: '2032-05-01',
    delivery: false,
    address: '12 Example Road, Jaipur',
  }, a.accessToken, { 'Idempotency-Key': 'customer-a-booking-1' });
  assert.equal(bookingResponse.status, 201);
  const created = await bookingResponse.json();
  const id = created.booking.bookingId;

  const own = await request('/api/v1/bookings/' + id, {
    headers: { authorization: 'Bearer ' + a.accessToken },
  });
  assert.equal(own.status, 200);

  const foreign = await request('/api/v1/bookings/' + id, {
    headers: { authorization: 'Bearer ' + b.accessToken },
  });
  assert.equal(foreign.status, 404);

  const history = await request('/api/v1/bookings', {
    headers: { authorization: 'Bearer ' + a.accessToken },
  });
  const historyPayload = await history.json();
  assert.equal(history.status, 200);
  assert.equal(historyPayload.bookings.length, 1);
  assert.equal(historyPayload.bookings[0].bookingId, id);

  const cancelled = await request('/api/v1/bookings/' + id + '/cancel', {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + b.accessToken },
  });
  assert.equal(cancelled.status, 404);
});

test('duplicate booking submission with the same idempotency key is replayed', async () => {
  const a = await register('+911234567895', 'Idempotent User');
  const headers = { 'Idempotency-Key': 'same-booking-key' };
  const payload = {
    vehicleId: 'baleno-01',
    durationDays: 1,
    startDate: '2032-06-01',
    delivery: false,
    address: '44 Example Road, Jaipur',
  };
  const first = await jsonRequest('/api/v1/bookings', 'POST', payload, a.accessToken, headers);
  const firstPayload = await first.json();
  const second = await jsonRequest('/api/v1/bookings', 'POST', payload, a.accessToken, headers);
  const secondPayload = await second.json();
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(firstPayload.booking.bookingId, secondPayload.booking.bookingId);
});

test('overlapping booking attempts return unavailable and non-overlapping booking remains possible', async () => {
  const a = await register('+911234567896', 'Overlap User');
  const first = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'classic-01',
    durationDays: 1,
    startDate: '2032-07-01',
    delivery: false,
    address: '8 Example Road, Jaipur',
  }, a.accessToken, { 'Idempotency-Key': 'overlap-1' });
  assert.equal(first.status, 201);

  const second = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'classic-01',
    durationDays: 1,
    startDate: '2032-07-01',
    delivery: false,
    address: '9 Example Road, Jaipur',
  }, a.accessToken, { 'Idempotency-Key': 'overlap-2' });
  const secondPayload = await second.json();
  assert.equal(second.status, 409);
  assert.equal(secondPayload.error.code, 'VEHICLE_UNAVAILABLE');
});

test('invalid booking input is rejected server-side', async () => {
  const a = await register('+911234567897', 'Validation User');
  const response = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'creta-01',
    durationDays: 1,
    startDate: '2032-02-31',
    delivery: true,
    address: 'Too short',
  }, a.accessToken);
  assert.equal(response.status, 400);
});

test('invalid webhook signature is rejected and payment state is never guessed', async () => {
  const response = await jsonRequest('/api/v1/payments/webhook', 'POST', {
    eventId: 'evt-1',
    bookingId: 'missing',
    status: 'paid',
  });
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error.code, 'INVALID_WEBHOOK_SIGNATURE');
});

test('expired bearer tokens are rejected', async () => {
  const response = await request('/api/v1/bookings', {
    headers: { authorization: 'Bearer invalid.token.value' },
  });
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error.code, 'INVALID_TOKEN');
});


test('quote and booking both require authentication', async () => {
  const quote = await jsonRequest('/api/v1/bookings/quote', 'POST', {
    vehicleId: 'creta-01',
    durationDays: 1,
    startDate: '2032-08-01',
    delivery: false,
  });
  const booking = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'creta-01',
    durationDays: 1,
    startDate: '2032-08-01',
    delivery: false,
    address: '12 Example Road, Jaipur',
  });
  assert.equal(quote.status, 401);
  assert.equal(booking.status, 401);
});

test('duplicate booking submissions without an idempotency key are not treated as the same request', async () => {
  const a = await register('+911234567898', 'No Key User');
  const payload = {
    vehicleId: 'activa-01',
    durationDays: 1,
    startDate: '2032-09-01',
    delivery: false,
    address: '20 Example Road, Jaipur',
  };
  const first = await jsonRequest('/api/v1/bookings', 'POST', payload, a.accessToken);
  const second = await jsonRequest('/api/v1/bookings', 'POST', payload, a.accessToken);
  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, 'VEHICLE_UNAVAILABLE');
});

test('valid payment lifecycle can only be advanced through a verified webhook', async () => {
  const a = await register('+911234567899', 'Payment User');
  const bookingResponse = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'baleno-01',
    durationDays: 1,
    startDate: '2032-10-01',
    delivery: false,
    address: '30 Example Road, Jaipur',
  }, a.accessToken);
  const created = await bookingResponse.json();
  const webhook = await jsonRequest('/api/v1/payments/webhook', 'POST', {
    eventId: 'evt-payment-1',
    bookingId: created.booking.bookingId,
    status: 'paid',
    providerReference: 'provider-ref-1',
  });
  assert.equal(webhook.status, 401);
});



test('booking round trip preserves API rupees after persistence', async () => {
  const a = await register('+911234567883', 'Persistence Currency User');
  const createResponse = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'creta-01',
    startDate: '2033-02-01',
    durationDays: 2,
    delivery: true,
    address: '101 Persistence Road, Jaipur',
  }, a.accessToken, { 'Idempotency-Key': 'persist-currency-1' });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.deepEqual(created.booking.pricing, {
    days: 2,
    rental: 4998,
    deliveryFee: 199,
    platformFee: 250,
    total: 5447,
    currency: 'INR',
    currencyUnit: 'rupees',
  });
  const detail = await request('/api/v1/bookings/' + created.booking.bookingId, {
    headers: { authorization: 'Bearer ' + a.accessToken },
  });
  const detailPayload = await detail.json();
  assert.equal(detail.status, 200);
  assert.equal(detailPayload.booking.vehicleId, 'creta-01');
  assert.equal(detailPayload.booking.pricing.rental, 4998);
  assert.equal(detailPayload.booking.pricing.total, 5447);
});


test('concurrent memory booking attempts cannot both reserve the same interval', async () => {
  const a = await register('+911234567880', 'Concurrent User');
  const payload = {
    vehicleId: 'creta-01',
    durationDays: 1,
    startDate: '2032-11-01',
    delivery: false,
    address: '99 Example Road, Jaipur',
  };
  const [first, second] = await Promise.all([
    jsonRequest('/api/v1/bookings', 'POST', payload, a.accessToken, { 'Idempotency-Key': 'concurrent-a' }),
    jsonRequest('/api/v1/bookings', 'POST', payload, a.accessToken, { 'Idempotency-Key': 'concurrent-b' }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [201, 409]);
});

test('valid vehicle IDs resolve and unknown vehicle IDs are rejected', async () => {
  const a = await register('+911234567881', 'Vehicle ID User');
  const valid = await jsonRequest('/api/v1/bookings/quote', 'POST', {
    vehicleId: 'creta-01',
    startDate: '2032-12-01',
    durationDays: 1,
    delivery: false,
  }, a.accessToken);
  const validPayload = await valid.json();
  assert.equal(valid.status, 200);
  assert.equal(validPayload.quote.vehicleId, 'creta-01');
  assert.equal(validPayload.quote.rental, 2499);

  const invalid = await jsonRequest('/api/v1/bookings/quote', 'POST', {
    vehicleId: 'does-not-exist',
    startDate: '2032-12-01',
    durationDays: 1,
    delivery: false,
  }, a.accessToken);
  assert.equal(invalid.status, 404);
  assert.equal((await invalid.json()).error.code, 'VEHICLE_NOT_FOUND');
});

test('quote pricing keeps rupees at the API boundary', async () => {
  const a = await register('+911234567882', 'Currency User');
  const response = await jsonRequest('/api/v1/bookings/quote', 'POST', {
    vehicleId: 'creta-01',
    startDate: '2033-01-01',
    durationDays: 2,
    delivery: true,
  }, a.accessToken);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.quote, {
    vehicleId: 'creta-01',
    days: 2,
    rental: 4998,
    deliveryFee: 199,
    platformFee: 250,
    total: 5447,
    currency: 'INR',
    currencyUnit: 'rupees',
  });
});

test('payment service validates event fields and ordering', () => {
  const service = createPaymentService({ provider: 'stripe', webhookSecret: 'test-secret' });
  const parsed = service.parseWebhook({
    eventId: 'evt-1',
    bookingId: 'booking-1',
    status: 'paid',
    providerReference: 'pay-1',
    amountPaise: 544700,
    currency: 'INR',
  });
  assert.deepEqual(parsed, {
    eventId: 'evt-1',
    bookingId: 'booking-1',
    status: 'paid',
    providerReference: 'pay-1',
    amountPaise: 544700,
    currency: 'INR',
  });
  assert.equal(service.canTransition('unpaid', 'pending'), true);
  assert.equal(service.canTransition('pending', 'paid'), true);
  assert.equal(service.canTransition('paid', 'pending'), false);
  assert.equal(service.canTransition('paid', 'failed'), false);
  assert.equal(service.canTransition('refunded', 'paid'), false);
  assert.equal(service.parseWebhook({ ...parsed, currency: 'USD' }), null);
});



test('configured webhook rejects wrong signature and accepts a correctly signed request shape', async () => {
  const service = createPaymentService({ provider: 'stripe', webhookSecret: 'test-secret' });
  const body = JSON.stringify({
    eventId: 'evt-signature',
    bookingId: 'booking-1',
    status: 'pending',
    providerReference: 'pay-1',
    amountPaise: 10000,
    currency: 'INR',
  });
  const signature = crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');
  assert.equal(service.verifyWebhook(body, 'bad'), false);
  assert.equal(service.verifyWebhook(body, signature), true);
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { createPaymentService } from './payments.js';

process.env.NODE_ENV = 'test';

const { app, repository } = await import('./server.js');

let server;
let base;

test.before(async () => {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});



const request = (path, options = {}) => fetch(`${base}${path}`, options);
const jsonRequest = (path, method, payload, token, extraHeaders = {}) => request(path, {
  method,
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  },
  body: JSON.stringify(payload),
});

async function register(phone = '+911234567890', fullName = 'Test User') {
  const response = await jsonRequest('/api/v1/auth/register', 'POST', {
    fullName,
    phone,
    email: `${phone.replace(/\D/g, '')}@example.com`,
    password: 'StrongPass123!',
  });
  assert.equal(response.status, 201);
  return response.json();
}




test('health endpoint reports storage state', async () => {
  const response = await request('/health');
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.storage.persistent, Boolean(process.env.DATABASE_URL));
});


test.after(async () => { await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); await repository.close(); });
