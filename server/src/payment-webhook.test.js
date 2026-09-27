import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.PAYMENT_PROVIDER = 'cashfree';
process.env.CASHFREE_WEBHOOK_SECRET = 'cashfree-webhook-test-secret';

const { app, repository } = await import('./server.js');

let server;
let base;

const request = (path, options = {}) => fetch(`${base}${path}`, options);

function signedWebhook(payload, timestamp = String(Date.now())) {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', process.env.CASHFREE_WEBHOOK_SECRET)
    .update(timestamp + body)
    .digest('base64');
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
    },
  };
}

function cashfreePaymentEvent({ orderId, paymentId, amount = 100, eventId = `evt-${orderId}` } = {}) {
  return {
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    event_id: eventId,
    data: {
      payment: {
        order_id: orderId,
        cf_payment_id: paymentId,
        payment_amount: amount,
        payment_currency: 'INR',
      },
      order: { order_id: orderId },
    },
  };
}

test.before(async () => {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await repository.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('valid signed Cashfree webhook with no local RideOn payment is acknowledged', async () => {
  const signed = signedWebhook(cashfreePaymentEvent({
    orderId: 'cashfree-unrelated-order',
    paymentId: 'cashfree-unrelated-payment',
    eventId: 'evt-unrelated-order',
  }));
  const response = await request('/api/v1/payments/webhook', {
    method: 'POST', headers: signed.headers, body: signed.body,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, applied: false });
});

test('valid signed Cashfree webhook for a matching RideOn payment uses the existing lifecycle', async () => {
  if (!process.env.DATABASE_URL) {
    await repository.seedMemoryVehicles([{
      id: 'webhook-test-bike', type: 'bike', name: 'Webhook Test Bike',
      city: 'Jaipur', pricePerDay: 100, active: true,
    }]);
  }
  const vehicle = await repository.getVehicle(process.env.DATABASE_URL ? 'activa-01' : 'webhook-test-bike');
  assert.ok(vehicle);
  const suffix = String(Date.now()).slice(-9);
  const customer = await repository.createCustomer({
    fullName: 'Webhook Test Customer',
    phone: '+91' + suffix,
    email: 'webhook-test-' + suffix + '@example.com',
    passwordHash: 'test-password-hash',
  });
  const booking = await repository.createBooking({
    customerId: customer.id,
    vehicle: { ...vehicle, pricePerDay: 100, ownerId: vehicle.ownerId || null },
    startAt: '2050-01-10T10:00:00.000Z',
    endAt: '2050-01-11T10:00:00.000Z',
    delivery: false,
    address: 'Webhook Test Road, Jaipur',
    pricing: { days: 1, rental: 100, deliveryFee: 0, platformFee: 0, securityDeposit: 0, total: 100, currency: 'INR', currencyUnit: 'rupees' },
  });
  await repository.createOrGetPaymentOrder({
    bookingId: booking.id,
    customerId: booking.customerId,
    provider: 'cashfree',
    amountPaise: 10000,
    currency: 'INR',
    providerOrder: { id: 'rideon-webhook-order', amountPaise: 10000, currency: 'INR' },
  });

  const signed = signedWebhook(cashfreePaymentEvent({
    orderId: 'rideon-webhook-order',
    paymentId: 'rideon-webhook-payment',
    amount: 100,
    eventId: 'evt-matching-payment',
  }));
  const response = await request('/api/v1/payments/webhook', {
    method: 'POST', headers: signed.headers, body: signed.body,
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.received, true);
  assert.equal(payload.applied, true);
  assert.equal(payload.duplicate, false);
  const payment = await repository.findPaymentByBooking(booking.id);
  assert.equal(payment.status, 'paid');
});

test('invalid Cashfree webhook signature is rejected', async () => {
  const signed = signedWebhook(cashfreePaymentEvent({
    orderId: 'cashfree-invalid-signature',
    paymentId: 'cashfree-invalid-payment',
    eventId: 'evt-invalid-signature',
  }));
  const response = await request('/api/v1/payments/webhook', {
    method: 'POST',
    headers: { ...signed.headers, 'x-webhook-signature': 'invalid-signature' },
    body: signed.body,
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'INVALID_WEBHOOK_SIGNATURE');
});

test('validly signed malformed Cashfree event is rejected', async () => {
  const signed = signedWebhook({
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    event_id: 'evt-malformed-payment',
    data: { payment: { order_id: 'cashfree-malformed-order' } },
  });
  const response = await request('/api/v1/payments/webhook', {
    method: 'POST', headers: signed.headers, body: signed.body,
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_PAYMENT_EVENT');
});
