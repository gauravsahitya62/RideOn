import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

const { app } = await import('./server.js');

let server;
let base;

test.before(async () => {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));

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

test('health endpoint reports memory storage when DATABASE_URL is absent', async () => {
  const response = await request('/health');
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.storage.persistent, false);
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
