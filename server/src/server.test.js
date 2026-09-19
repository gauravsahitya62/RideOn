import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
process.env.NODE_ENV = 'test';
const { app } = await import('./server.js');
let server; let base;
test.before(async () => { server = createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
const post = (path, payload) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
test('health endpoint responds', async () => { const r = await fetch(`${base}/health`); assert.equal(r.status, 200); assert.equal((await r.json()).status, 'ok'); });
test('vehicle list includes native UI display aliases', async () => { const r = await fetch(`${base}/api/v1/vehicles`); const p = await r.json(); assert.equal(r.status, 200); assert.ok(p.vehicles.length > 0); assert.equal(p.vehicles[0].price, p.vehicles[0].pricePerDay); assert.ok(p.vehicles[0].detail); assert.ok(p.vehicles[0].emoji); });
test('vehicle filters return category matches', async () => { const r = await fetch(`${base}/api/v1/vehicles?type=bike`); const p = await r.json(); assert.equal(r.status, 200); assert.ok(p.data.length > 0); assert.ok(p.data.every((v) => v.type === 'bike')); });
test('vehicle search is case-insensitive and uses the q contract', async () => { const r = await fetch(`${base}/api/v1/vehicles?q=CRETA`); const p = await r.json(); assert.equal(r.status, 200); assert.equal(p.data.length, 1); assert.equal(p.data[0].id, 'creta-01'); });
test('quote rejects malformed payload', async () => { assert.equal((await post('/api/v1/bookings/quote', { vehicleId: 'x' })).status, 400); });
test('booking rejects missing address and vehicle details', async () => { assert.equal((await post('/api/v1/bookings', { vehicleId: 'creta-01' })).status, 400); });
test('invalid mobile date returns validation error instead of crashing', async () => { const r = await post('/api/v1/bookings', { vehicleId: 'creta-01', durationDays: 1, startDate: '2030-02-31', delivery: true, address: '12 Example Road, Jaipur' }); assert.equal(r.status, 400); });
test('mobile-shaped booking request is accepted and exposes aliases', async () => { const r = await post('/api/v1/bookings', { vehicleId: 'creta-01', durationDays: 2, startDate: '2030-05-01', delivery: true, address: '12 Example Road, Jaipur' }); const p = await r.json(); assert.equal(r.status, 201); assert.equal(p.booking.id, p.booking.bookingId); assert.equal(p.booking.vehicleName, 'Hyundai Creta'); assert.equal(p.booking.totalPrice, 2499 * 2 + 199 + Math.round(2499 * 2 * 0.05)); });
test('overlapping active booking requests are rejected', async () => { const r = await post('/api/v1/bookings', { vehicleId: 'creta-01', durationDays: 1, startDate: '2030-05-01', delivery: false, address: '12 Example Road, Jaipur' }); assert.equal(r.status, 409); assert.equal((await r.json()).error.code, 'VEHICLE_UNAVAILABLE'); });

test('get booking returns a booking with status and payment state', async () => {
  const r = await post('/api/v1/bookings', { vehicleId: 'baleno-01', durationDays: 1, startDate: '2030-06-01', delivery: false, address: '12 Example Road, Jaipur' });
  assert.equal(r.status, 201);
  const created = await r.json();
  const detail = await fetch(`${base}/api/v1/bookings/${created.booking.bookingId}`);
  const p = await detail.json();
  assert.equal(detail.status, 200);
  assert.equal(p.booking.bookingId, created.booking.bookingId);
  assert.equal(p.booking.status, 'requested');
  assert.equal(p.booking.paymentStatus, 'unpaid');
});

test('eligible booking can be cancelled and returns cancelled status', async () => {
  const r = await post('/api/v1/bookings', { vehicleId: 'activa-01', durationDays: 1, startDate: '2030-07-01', delivery: false, address: '12 Example Road, Jaipur' });
  assert.equal(r.status, 201);
  const created = await r.json();
  const cancelled = await fetch(`${base}/api/v1/bookings/${created.booking.bookingId}/cancel`, { method: 'PATCH' });
  const p = await cancelled.json();
  assert.equal(cancelled.status, 200);
  assert.equal(p.booking.status, 'cancelled');
});

test('cancelled booking cannot be cancelled again', async () => {
  const r = await post('/api/v1/bookings', { vehicleId: 'classic-01', durationDays: 1, startDate: '2030-08-01', delivery: false, address: '12 Example Road, Jaipur' });
  const created = await r.json();
  await fetch(`${base}/api/v1/bookings/${created.booking.bookingId}/cancel`, { method: 'PATCH' });
  const second = await fetch(`${base}/api/v1/bookings/${created.booking.bookingId}/cancel`, { method: 'PATCH' });
  const p = await second.json();
  assert.equal(second.status, 409);
  assert.equal(p.error.code, 'CANNOT_CANCEL');
});


test('booking success payload contains an explicit unpaid payment state and no transaction id', async () => {\n  const r = await post('/api/v1/bookings', { vehicleId: 'baleno-01', durationDays: 1, startDate: '2030-09-01', delivery: false, address: '12 Example Road, Jaipur' });\n  assert.equal(r.status, 201);\n  const p = await r.json();\n  assert.equal(p.booking.paymentStatus, 'unpaid');\n  assert.equal('transactionId' in p.booking, false);\n});\n\ntest('quote returns a server-calculated total and disclaimer', async () => {\n  const r = await post('/api/v1/bookings/quote', { vehicleId: 'activa-01', durationDays: 2, startDate: '2030-10-01', delivery: true });\n  assert.equal(r.status, 200);\n  const p = await r.json();\n  assert.equal(p.quote.rental, 499 * 2);\n  assert.equal(p.quote.deliveryFee, 199);\n  assert.equal(p.quote.total, 499 * 2 + 199 + Math.round(499 * 2 * 0.05));\n  assert.match(p.quote.disclaimer, /Demo estimate/);\n});\n\ntest('missing booking id is reported as a not-found error', async () => {\n  const r = await fetch(base + '/api/v1/bookings/does-not-exist');\n  assert.equal(r.status, 404);\n  const p = await r.json();\n  assert.equal(p.error.code, 'BOOKING_NOT_FOUND');\n});\n