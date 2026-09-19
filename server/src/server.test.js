import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
const { app } = await import('./server.js');
let server;
let base;
test.before(async () => {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
const post = (path, payload) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
test('health endpoint responds', async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});
test('vehicle filters return category matches', async () => {
  const response = await fetch(`${base}/api/v1/vehicles?type=bike`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.data.length > 0);
  assert.ok(payload.data.every((vehicle) => vehicle.type === 'bike'));
});
test('quote rejects malformed payload', async () => {
  const response = await post('/api/v1/bookings/quote', { vehicleId: 'x' });
  assert.equal(response.status, 400);
});
test('booking rejects missing address and vehicle details', async () => {
  const response = await post('/api/v1/bookings', { vehicleId: 'creta-01' });
  assert.equal(response.status, 400);
});
test('mobile-shaped booking request is accepted and exposes expected aliases', async () => {
  const response = await post('/api/v1/bookings', { vehicleId: 'creta-01', durationDays: 2, startDate: '2030-05-01', delivery: true, address: '12 Example Road, Jaipur' });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.booking.id, payload.booking.bookingId);
  assert.equal(payload.booking.vehicleName, 'Hyundai Creta');
  assert.equal(payload.booking.totalPrice, 2499 * 2 + 199 + Math.round(2499 * 2 * 0.05));
});
test('overlapping active booking requests are rejected', async () => {
  const response = await post('/api/v1/bookings', { vehicleId: 'creta-01', durationDays: 1, startDate: '2030-05-01', delivery: false, address: '12 Example Road, Jaipur' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'VEHICLE_UNAVAILABLE');
});
