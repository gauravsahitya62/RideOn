import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Set this before importing the app: server.js intentionally avoids binding a
// production port in test mode. The test suite owns its ephemeral HTTP server.
process.env.NODE_ENV = 'test';
const { app } = await import('./server.js');

let server;
let base;
test.before(async () => {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});

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
  const response = await fetch(`${base}/api/v1/bookings/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vehicleId: 'x' }),
  });
  assert.equal(response.status, 400);
});

test('booking validates customer fields', async () => {
  const response = await fetch(`${base}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vehicleId: 'creta-01' }),
  });
  assert.equal(response.status, 400);
});
