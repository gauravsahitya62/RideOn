import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createPaymentService } from './payments.js';

process.env.NODE_ENV = 'test';

const { app, repository } = await import('./server.js');

let server;
let base;
let serverStarted = false;

const testVehicles = [
  { id:'creta-01', type:'car', name:'Hyundai Creta', city:'Jaipur', pricePerDay:2499, active:true, transmission:'Automatic', fuel:'Petrol', seats:5, securityDeposit:0 },
  { id:'baleno-01', type:'car', name:'Maruti Baleno', city:'Jaipur', pricePerDay:1499, active:true, transmission:'Manual', fuel:'Petrol', seats:5, securityDeposit:0 },
  { id:'classic-01', type:'bike', name:'Royal Enfield Classic 350', city:'Jaipur', pricePerDay:999, active:true, transmission:null, fuel:null, seats:2, securityDeposit:0 },
  { id:'activa-01', type:'bike', name:'Honda Activa 6G', city:'Jaipur', pricePerDay:499, active:true, transmission:'Automatic', fuel:'Petrol', seats:2, securityDeposit:0 },
];

async function seedPostgresTestVehicles() {
  if (process.env.DATABASE_URL) {
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      for (const vehicle of testVehicles) {
        await pool.query(
          `insert into vehicles (id,type,name,city,daily_rate_paise,active,transmission,fuel,seats)
           values ($1,$2,$3,$4,$5,true,$6,$7,$8)
           on conflict (id) do update set active=true, daily_rate_paise=excluded.daily_rate_paise,
             name=excluded.name, city=excluded.city, transmission=excluded.transmission,
             fuel=excluded.fuel, seats=excluded.seats`,
          [vehicle.id,vehicle.type,vehicle.name,vehicle.city,Math.round(vehicle.pricePerDay*100),vehicle.transmission,vehicle.fuel,vehicle.seats]
        );
      }
    } finally {
      await pool.end();
    }
  } else {
    await repository.seedMemoryVehicles(testVehicles);
  }
}

test.before(async () => {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverStarted = true;
  base = `http://127.0.0.1:${server.address().port}`;
  await seedPostgresTestVehicles();
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

async function legacyLogin(phone) {
  const response = await jsonRequest('/api/v1/auth/login', 'POST', {
    phone,
    password: 'StrongPass123!',
  });
  assert.equal(response.status, 200);
  return response.json();
}

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
  assert.ok(Array.isArray(payload.data));
  assert.ok(payload.data.length >= 1);
  const creta = payload.data.find((vehicle) => vehicle.id === 'creta-01');
  assert.ok(creta);
  assert.equal(creta.price, creta.pricePerDay);
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
  const aLogin = await legacyLogin('+911234567893');
  const b = await register('+911234567894', 'Customer B');
  const bLogin = await legacyLogin('+911234567894');
  const bookingResponse = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'creta-01',
    durationDays: 1,
    startDate: '2032-05-01',
    delivery: false,
    address: '12 Example Road, Jaipur',
  }, aLogin.accessToken, { 'Idempotency-Key': 'customer-a-booking-1' });
  assert.equal(bookingResponse.status, 201);
  const created = await bookingResponse.json();
  const id = created.booking.bookingId;

  const own = await request('/api/v1/bookings/' + id, {
    headers: { authorization: 'Bearer ' + aLogin.accessToken },
  });
  assert.equal(own.status, 200);

  const foreign = await request('/api/v1/bookings/' + id, {
    headers: { authorization: 'Bearer ' + bLogin.accessToken },
  });
  assert.equal(foreign.status, 404);

  const history = await request('/api/v1/bookings', {
    headers: { authorization: 'Bearer ' + aLogin.accessToken },
  });
  const historyPayload = await history.json();
  assert.equal(history.status, 200);
  assert.equal(historyPayload.bookings.length, 1);
  assert.equal(historyPayload.bookings[0].bookingId, id);

  const cancelled = await request('/api/v1/bookings/' + id + '/cancel', {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + bLogin.accessToken },
  });
  assert.equal(cancelled.status, 404);
});

test('duplicate booking submission with the same idempotency key is replayed', async () => {
  const a = await register('+911234567895', 'Idempotent User');
  const aLogin = await legacyLogin('+911234567895');
  const headers = { 'Idempotency-Key': 'same-booking-key' };
  const payload = {
    vehicleId: 'baleno-01',
    durationDays: 1,
    startDate: '2032-06-01',
    delivery: false,
    address: '44 Example Road, Jaipur',
  };
  const first = await jsonRequest('/api/v1/bookings', 'POST', payload, aLogin.accessToken, headers);
  const firstPayload = await first.json();
  const second = await jsonRequest('/api/v1/bookings', 'POST', payload, aLogin.accessToken, headers);
  const secondPayload = await second.json();
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(firstPayload.booking.bookingId, secondPayload.booking.bookingId);
});

test('concurrent requests with the same idempotency key replay one booking', async () => {
  const a = await register('+911234567884', 'Concurrent Idempotency User');
  const aLogin = await legacyLogin('+911234567884');
  const payload = { vehicleId: 'baleno-01', startDate: '2033-03-01', durationDays: 1, delivery: false, address: '111 Concurrent Road, Jaipur' };
  const [first, second] = await Promise.all([
    jsonRequest('/api/v1/bookings', 'POST', payload, aLogin.accessToken, { 'Idempotency-Key': 'same-concurrent-key' }),
    jsonRequest('/api/v1/bookings', 'POST', payload, aLogin.accessToken, { 'Idempotency-Key': 'same-concurrent-key' }),
  ]);
  const statuses = [first.status, second.status].sort();
  const firstPayload = await first.json();
  const secondPayload = await second.json();
  assert.deepEqual(statuses, [200, 201]);
  assert.equal(firstPayload.booking.bookingId, secondPayload.booking.bookingId);
});

test('overlapping booking attempts return unavailable and non-overlapping booking remains possible', async () => {
  const a = await register('+911234567896', 'Overlap User');
  const aLogin = await legacyLogin('+911234567896');
  const first = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'classic-01',
    durationDays: 1,
    startDate: '2032-07-01',
    delivery: false,
    address: '8 Example Road, Jaipur',
  }, aLogin.accessToken, { 'Idempotency-Key': 'overlap-1' });
  assert.equal(first.status, 201);

  const second = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'classic-01',
    durationDays: 1,
    startDate: '2032-07-01',
    delivery: false,
    address: '9 Example Road, Jaipur',
  }, aLogin.accessToken, { 'Idempotency-Key': 'overlap-2' });
  const secondPayload = await second.json();
  assert.equal(second.status, 409);
  assert.equal(secondPayload.error.code, 'VEHICLE_UNAVAILABLE');
});

test('invalid booking input is rejected server-side', async () => {
  const a = await register('+911234567897', 'Validation User');
  const aLogin = await legacyLogin('+911234567897');
  const response = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'creta-01',
    durationDays: 1,
    startDate: '2032-02-31',
    delivery: true,
    address: 'Too short',
  }, aLogin.accessToken);
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
  const aLogin = await legacyLogin('+911234567898');
  const payload = {
    vehicleId: 'activa-01',
    durationDays: 1,
    startDate: '2032-09-01',
    delivery: false,
    address: '20 Example Road, Jaipur',
  };
  const first = await jsonRequest('/api/v1/bookings', 'POST', payload, aLogin.accessToken);
  const second = await jsonRequest('/api/v1/bookings', 'POST', payload, aLogin.accessToken);
  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, 'VEHICLE_UNAVAILABLE');
});

test('valid payment lifecycle can only be advanced through a verified webhook', async () => {
  const a = await register('+911234567899', 'Payment User');
  const aLogin = await legacyLogin('+911234567899');
  const bookingResponse = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'baleno-01',
    durationDays: 1,
    startDate: '2032-10-01',
    delivery: false,
    address: '30 Example Road, Jaipur',
  }, aLogin.accessToken);
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
  const aLogin = await legacyLogin('+911234567880');
  const payload = {
    vehicleId: 'creta-01',
    durationDays: 1,
    startDate: '2032-11-01',
    delivery: false,
    address: '99 Example Road, Jaipur',
  };
  const [first, second] = await Promise.all([
    jsonRequest('/api/v1/bookings', 'POST', payload, aLogin.accessToken, { 'Idempotency-Key': 'concurrent-a' }),
    jsonRequest('/api/v1/bookings', 'POST', payload, aLogin.accessToken, { 'Idempotency-Key': 'concurrent-b' }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [201, 409]);
});

test('booking round trip preserves API rupees after persistence', async () => {
  const a = await register('+911234567883', 'Persistence Currency User');
  const aLogin = await legacyLogin('+911234567883');
  const response = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'creta-01',
    startDate: '2033-02-01',
    durationDays: 2,
    delivery: true,
    address: '101 Persistence Road, Jaipur',
  }, aLogin.accessToken, { 'Idempotency-Key': 'persist-currency-1' });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.deepEqual(created.booking.pricing, {
    days: 2,
    rental: 4998,
    deliveryFee: 199,
    platformFee: 250,
    securityDeposit: 0,
    total: 5447,
    currency: 'INR',
    currencyUnit: 'rupees',
  });
  const detail = await request('/api/v1/bookings/' + created.booking.bookingId, { headers: { authorization: 'Bearer ' + aLogin.accessToken }});
  const detailPayload = await detail.json();
  assert.equal(detail.status, 200);
  assert.equal(detailPayload.booking.vehicleId, 'creta-01');
  assert.equal(detailPayload.booking.pricing.total, 5447);
});

test('valid vehicle IDs resolve and unknown vehicle IDs are rejected', async () => {
  const a = await register('+911234567881', 'Vehicle ID User');
  const aLogin = await legacyLogin('+911234567881');
  const valid = await jsonRequest('/api/v1/bookings/quote', 'POST', { vehicleId: 'creta-01', startDate: '2032-12-01', durationDays: 1, delivery: false }, aLogin.accessToken);
  const validPayload = await valid.json();
  assert.equal(valid.status, 200);
  assert.equal(validPayload.quote.vehicleId, 'creta-01');
  assert.equal(validPayload.quote.rental, 2499);
  const invalid = await jsonRequest('/api/v1/bookings/quote', 'POST', { vehicleId: 'does-not-exist', startDate: '2032-12-01', durationDays: 1, delivery: false }, aLogin.accessToken);
  assert.equal(invalid.status, 404);
  assert.equal((await invalid.json()).error.code, 'VEHICLE_NOT_FOUND');
});

test('quote pricing keeps rupees at the API boundary', async () => {
  const a = await register('+911234567882', 'Currency User');
  const aLogin = await legacyLogin('+911234567882');
  const response = await jsonRequest('/api/v1/bookings/quote', 'POST', { vehicleId: 'creta-01', startDate: '2033-01-01', durationDays: 2, delivery: true }, aLogin.accessToken);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.quote, { vehicleId: 'creta-01', days: 2, rental: 4998, deliveryFee: 199, platformFee: 250, securityDeposit: 0, total: 5447, currency: 'INR', currencyUnit: 'rupees' });
});



test('availability endpoint reports available and unavailable windows', async () => {
  const a = await register('+911234567910', 'Availability User');
  const login = await legacyLogin('+911234567910');
  const available = await request('/api/v1/vehicles/creta-01/availability?startAt=2034-01-10T10:00:00.000Z&endAt=2034-01-12T10:00:00.000Z', {
    headers: { authorization: 'Bearer ' + login.accessToken },
  });
  const availablePayload = await available.json();
  assert.equal(available.status, 200);
  assert.equal(availablePayload.available, true);

  const created = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'creta-01',
    startAt: '2034-02-10T10:00:00.000Z',
    endAt: '2034-02-12T10:00:00.000Z',
    delivery: false,
    address: '10 Availability Road, Jaipur',
  }, login.accessToken, { 'Idempotency-Key': 'availability-seed-1' });
  assert.equal(created.status, 201);

  const busy = await request('/api/v1/vehicles/creta-01/availability?startAt=2034-02-10T10:00:00.000Z&endAt=2034-02-11T10:00:00.000Z', {
    headers: { authorization: 'Bearer ' + login.accessToken },
  });
  const busyPayload = await busy.json();
  assert.equal(busy.status, 200);
  assert.equal(busyPayload.available, false);
});

test('availability rejects invalid windows', async () => {
  await register('+911234567911', 'Invalid Window User');
  const login = await legacyLogin('+911234567911');
  const response = await request('/api/v1/vehicles/creta-01/availability?startAt=not-a-date&endAt=2034-03-02T10:00:00.000Z', {
    headers: { authorization: 'Bearer ' + login.accessToken },
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'INVALID_BOOKING_WINDOW');
});

test('different idempotency keys cannot reserve an overlapping interval twice', async () => {
  const a = await register('+911234567912', 'Conflict User');
  const login = await legacyLogin('+911234567912');
  const payload = {
    vehicleId: 'baleno-01',
    startAt: '2034-04-10T10:00:00.000Z',
    endAt: '2034-04-12T10:00:00.000Z',
    delivery: false,
    address: '12 Conflict Road, Jaipur',
  };
  const first = await jsonRequest('/api/v1/bookings', 'POST', payload, login.accessToken, { 'Idempotency-Key': 'conflict-a' });
  const second = await jsonRequest('/api/v1/bookings', 'POST', payload, login.accessToken, { 'Idempotency-Key': 'conflict-b' });
  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, 'VEHICLE_UNAVAILABLE');
});

test('cancellation records the actual previous status', async () => {
  const a = await register('+911234567913', 'Cancellation User');
  const login = await legacyLogin('+911234567913');
  const created = await jsonRequest('/api/v1/bookings', 'POST', {
    vehicleId: 'activa-01',
    startAt: '2034-05-10T10:00:00.000Z',
    endAt: '2034-05-11T10:00:00.000Z',
    delivery: false,
    address: '13 Cancel Road, Jaipur',
  }, login.accessToken, { 'Idempotency-Key': 'cancel-event-1' });
  assert.equal(created.status, 201);
  const bookingId = (await created.json()).booking.bookingId;
  const cancelled = await request('/api/v1/bookings/' + bookingId + '/cancel', {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + login.accessToken },
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).booking.status, 'cancelled');
  const duplicate = await request('/api/v1/bookings/' + bookingId + '/cancel', { method:'PATCH', headers:{authorization:'Bearer ' + login.accessToken} });
  assert.equal(duplicate.status,409);
  assert.equal((await duplicate.json()).error.code,'CANCELLATION_NOT_ALLOWED');
});

test('cancellation preview returns server-calculated refund data', async () => {
  const a = await register('+911234567918', 'Cancellation Preview User');
  const login = await legacyLogin('+911234567918');
  const created = await jsonRequest('/api/v1/bookings','POST',{
    vehicleId:'activa-01',startAt:'2037-01-10T10:00:00.000Z',endAt:'2037-01-11T10:00:00.000Z',
    delivery:false,address:'16 Policy Road, Jaipur',
  },login.accessToken,{ 'Idempotency-Key':'cancel-preview-1' });
  assert.equal(created.status,201);
  const bookingId=(await created.json()).booking.bookingId;
  const preview=await request('/api/v1/bookings/'+bookingId+'/cancellation-preview',{headers:{authorization:'Bearer '+login.accessToken}});
  const payload=await preview.json();
  assert.equal(preview.status,200);
  assert.equal(payload.cancellation.allowed,true);
  assert.equal(typeof payload.cancellation.totalRefund,'number');
});

test('inactive vehicle cannot be checked or booked', async () => {
  await repository.seedMemoryVehicles([
    { id:'inactive-01', type:'car', name:'Inactive Car', city:'Jaipur', pricePerDay:1000, active:false, transmission:'Manual', fuel:'Petrol', seats:5, securityDeposit:0 },
  ]);
  const user = await register('+911234567914', 'Inactive Vehicle User');
  const login = await legacyLogin('+911234567914');

  const availability = await request('/api/v1/vehicles/inactive-01/availability?startAt=2036-01-10T10:00:00.000Z&endAt=2036-01-11T10:00:00.000Z', {
    headers:{authorization:'Bearer '+login.accessToken},
  });
  assert.equal(availability.status, 409);
  assert.equal((await availability.json()).error.code, 'VEHICLE_INACTIVE');

  const booking = await jsonRequest('/api/v1/bookings','POST',{
    vehicleId:'inactive-01',
    startAt:'2036-01-10T10:00:00.000Z',
    endAt:'2036-01-11T10:00:00.000Z',
    delivery:false,
    address:'14 Inactive Road, Jaipur',
  },login.accessToken,{ 'Idempotency-Key':'inactive-booking-1' });
  assert.equal(booking.status,409);
  assert.equal((await booking.json()).error.code,'VEHICLE_INACTIVE');
});

test('vendor booking lifecycle is isolated and customer-visible', async () => {
  const customer = await register('+911234567915', 'Lifecycle Customer');
  const customerLogin = await legacyLogin('+911234567915');
  const vendorCustomer = await register('+911234567916', 'Vendor A User');
  const otherVendorCustomer = await register('+911234567917', 'Vendor B User');

  const vendorA = await repository.ensureVendorForCustomer(vendorCustomer.customer.id);
  const vendorB = await repository.ensureVendorForCustomer(otherVendorCustomer.customer.id);
  const vehicleA = await repository.createVendorVehicle(vendorA.id, {
    type:'car', name:'Vendor A Car', make:'Test', model:'A', year:2034, city:'Jaipur',
    dailyRate:1200, securityDeposit:500, transmission:'Manual', fuel:'Petrol', seats:5,
    registrationNumber:'RJ14LIFE001', description:'Lifecycle test vehicle', imageUrls:[], deliveryAvailable:true, active:true,
  });
  await repository.createVendorVehicle(vendorB.id, {
    type:'car', name:'Vendor B Car', make:'Test', model:'B', year:2034, city:'Jaipur',
    dailyRate:1300, securityDeposit:500, transmission:'Manual', fuel:'Petrol', seats:5,
    registrationNumber:'RJ14LIFE002', description:'Other lifecycle vehicle', imageUrls:[], deliveryAvailable:true, active:true,
  });

  const bookingResponse = await jsonRequest('/api/v1/bookings','POST',{
    vehicleId:vehicleA.id,
    startAt:'2036-06-10T10:00:00.000Z',
    endAt:'2036-06-11T10:00:00.000Z',
    delivery:false,
    address:'15 Vendor Lifecycle Road, Jaipur',
  },customerLogin.accessToken,{ 'Idempotency-Key':'vendor-lifecycle-1' });
  assert.equal(bookingResponse.status,201);
  const bookingForPayment = await repository.getBooking(bookingId, customer.customer.id);
  await repository.createOrGetPaymentOrder({bookingId,customerId:customer.customer.id,provider:'mock',amountPaise:Math.round(bookingForPayment.pricing.total*100),currency:'INR',providerOrder:{id:'test-vendor-lifecycle-'+bookingId,amountPaise:Math.round(bookingForPayment.pricing.total*100),currency:'INR'}});
  await repository.applyPaymentEvent({eventId:'paid-vendor-lifecycle-'+bookingId,bookingId,paymentId:undefined,providerReference:'paid-vendor-lifecycle-ref-'+bookingId,providerOrderId:'test-vendor-lifecycle-'+bookingId,amountPaise:Math.round(bookingForPayment.pricing.total*100),currency:'INR',status:'paid'});

  const vendorAToken = jwt.sign({sub:vendorCustomer.customer.id,role:'vendor'},'development-only-secret');
  const vendorBToken = jwt.sign({sub:otherVendorCustomer.customer.id,role:'vendor'},'development-only-secret');

  const ownList = await request('/api/v1/vendor/bookings',{headers:{authorization:'Bearer '+vendorAToken}});
  assert.equal(ownList.status,200);
  assert.equal((await ownList.json()).bookings.length,1);

  const foreignDetail = await request('/api/v1/vendor/bookings/'+bookingId,{headers:{authorization:'Bearer '+vendorBToken}});
  assert.equal(foreignDetail.status,404);

  const customerTransition = await request('/api/v1/vendor/bookings/'+bookingId+'/status',{
    method:'PATCH',
    headers:{authorization:'Bearer '+customerLogin.accessToken,'content-type':'application/json'},
    body:JSON.stringify({status:'confirmed'}),
  });
  assert.equal(customerTransition.status,403);

  const confirm = await jsonRequest('/api/v1/vendor/bookings/'+bookingId+'/status','PATCH',{status:'confirmed'},vendorAToken);
  assert.equal(confirm.status,200);
  assert.equal((await confirm.json()).booking.status,'confirmed');

  const customerDetail = await request('/api/v1/bookings/'+bookingId,{headers:{authorization:'Bearer '+customerLogin.accessToken}});
  assert.equal(customerDetail.status,200);
  assert.equal((await customerDetail.json()).booking.status,'confirmed');

  const invalidTransition = await jsonRequest('/api/v1/vendor/bookings/'+bookingId+'/status','PATCH',{status:'rejected'},vendorAToken);
  assert.equal(invalidTransition.status,409);

  const start = await jsonRequest('/api/v1/vendor/bookings/'+bookingId+'/status','PATCH',{status:'in_progress'},vendorAToken);
  assert.equal(start.status,200);
  const complete = await jsonRequest('/api/v1/vendor/bookings/'+bookingId+'/status','PATCH',{status:'completed'},vendorAToken);
  assert.equal(complete.status,200);
  assert.equal((await complete.json()).booking.status,'completed');

  const cancelled = await request('/api/v1/bookings/'+bookingId+'/cancel',{
    method:'PATCH',
    headers:{authorization:'Bearer '+customerLogin.accessToken},
  });
  assert.equal(cancelled.status,409);
});

test('vendor APIs reject anonymous callers', async () => {
  const response = await request('/api/v1/vendor/vehicles');
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error.code, 'AUTH_REQUIRED');
});

test('Supabase identity roles persist and vendor onboarding is idempotent', async () => {
  const email='supabase-role-test@example.com';
  const supabaseUserId=crypto.randomUUID();
  const first=await repository.createOrLinkCustomerFromSupabase({
    supabaseUserId,email,fullName:'Role Vendor',phone:'+911234567899',role:'vendor'
  });
  const second=await repository.createOrLinkCustomerFromSupabase({
    supabaseUserId,email,fullName:'Role Vendor Changed',phone:'+911234567899',role:'vendor'
  });
  assert.equal(first.id,second.id);
  assert.equal(second.role,'vendor');

  const vendorOne=await repository.ensureVendorForCustomer(first.id,{
    businessName:'Role Vendor',contactName:'Role Vendor',phone:'+911234567899',email
  });
  const vendorTwo=await repository.ensureVendorForCustomer(first.id,{
    businessName:'Role Vendor Retry',contactName:'Role Vendor',phone:'+911234567899',email
  });
  assert.equal(vendorOne.id,vendorTwo.id);
});

test('Supabase identity refuses customer/vendor account-type conflicts', async () => {
  const email='supabase-role-conflict@example.com';
  const supabaseUserId=crypto.randomUUID();
  await repository.createOrLinkCustomerFromSupabase({
    supabaseUserId,email,fullName:'Conflict Vendor',phone:'+911234567898',role:'vendor'
  });
  await assert.rejects(
    () => repository.createOrLinkCustomerFromSupabase({
      supabaseUserId:crypto.randomUUID(),email,fullName:'Conflict Customer',phone:'+911234567897',role:'customer'
    }),
    error => error.code==='ACCOUNT_TYPE_CONFLICT'
  );
});

test('customer identity exposes the existing current-user contract', async () => {
  const customer = await register('+911234567901', 'Current User Contract');
  const customerLogin = await legacyLogin('+911234567901');
  const response = await request('/api/v1/me', { headers:{ authorization:'Bearer ' + customerLogin.accessToken } });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.customer);
  assert.ok(payload.customer.id);
});

test('vendor endpoints reject legacy customer credentials', async () => {
  const customer = await register('+911234567900', 'Vendor API Customer');
  const customerLogin = await legacyLogin('+911234567900');
  const profile = await request('/api/v1/vendor/me', {
    headers: { authorization: 'Bearer ' + customerLogin.accessToken },
  });
  assert.equal(profile.status, 403);
  const fleet = await request('/api/v1/vendor/vehicles', {
    headers: { authorization: 'Bearer ' + customerLogin.accessToken },
  });
  assert.equal(fleet.status, 403);
});

test('customer booking APIs remain customer-role protected', async () => {
  const anonymous = await request('/api/v1/bookings');
  assert.equal(anonymous.status, 401);
  const vehicle = await request('/api/v1/vehicles');
  assert.equal(vehicle.status, 200);
});


test('payment creation rejects anonymous callers', async () => {
  const response = await jsonRequest('/api/v1/payments/create-order','POST',{bookingId:'00000000-0000-0000-0000-000000000000'});
  assert.equal(response.status,401);
  assert.equal((await response.json()).error.code,'AUTH_REQUIRED');
});


test('payment provider state machine blocks client-side paid transitions', () => {
  const service = createPaymentService({ provider:'mock', webhookSecret:'mock-secret' });
  assert.equal(service.canTransition('pending','paid'), true);
  assert.equal(service.canTransition('paid','pending'), false);
  assert.equal(service.canTransition('paid','refunded'), true);
  assert.equal(service.canTransition('pending','settled'), false);
});

test('mock payment provider creates a deterministic checkout order without network access', async () => {
  const service = createPaymentService({ provider:'mock', webhookSecret:'mock-secret' });
  const payment = await service.createCustomerPayment({
    orderId:'booking-test-1',
    amountPaise:544700,
  });
  assert.equal(payment.provider,'mock');
  assert.equal(payment.amountPaise,544700);
  assert.equal(payment.currency,'INR');
  assert.equal(payment.status,'pending');
  assert.match(payment.paymentUrl,/^https:\/\/paytm\.test\/checkout\//);
});

test('payment webhook signature and payload are validated', () => {
  const service = createPaymentService({ provider:'mock', webhookSecret:'mock-secret' });
  const valid = {
    eventId:'evt-payment-1',
    bookingId:'booking-1',
    paymentId:'payment-1',
    providerReference:'provider-ref-1',
    providerOrderId:'order-1',
    amountPaise:544700,
    currency:'INR',
    status:'paid',
  };
  const body = JSON.stringify(valid);
  const signature = crypto.createHmac('sha256','mock-secret').update(body).digest('hex');
  assert.equal(service.verifyWebhook(body,signature),true);
  assert.equal(service.verifyWebhook(body,'bad'),false);
  assert.equal(service.parseWebhook(valid).status,'paid');
  assert.equal(service.parseWebhook({...valid,amountPaise:0}),null);
});

test('real production provider without verified UPI integration fails closed', async () => {
  const service = createPaymentService({ provider:'paytm',merchantId:'m',clientId:'c',clientSecret:'s',website:'w',callbackUrl:'cb' });
  assert.equal(service.configured,true);
  await assert.rejects(() => service.createCustomerPayment({orderId:'rideon-test',amountPaise:10000}),(error)=>error.code==='UPI_PROVIDER_INTEGRATION_REQUIRED');
});

test('payment capability model is UPI-first and provider-agnostic', () => {
  const service = createPaymentService({ provider:'mock', webhookSecret:'mock-secret' });
  assert.equal(service.capabilities.method,'upi');
  assert.equal(service.capabilities.supportsIntent,true);
  assert.equal(service.capabilities.supportsVpa,true);
  assert.deepEqual(service.capabilities.apps.map(x=>x.id),['gpay','phonepe','paytm']);
});

test('request correlation is returned on a 404 response', async () => {
  const response = await request('/missing-route', { headers:{'X-Request-Id':'rideon-test-123'} });
  const payload = await response.json();
  assert.equal(response.status,404);
  assert.equal(response.headers.get('x-request-id'),'rideon-test-123');
  assert.equal(payload.error.requestId,'rideon-test-123');
});

test.after(async () => {
  try {
    if (server?.listening) await new Promise((resolve) => server.close(() => resolve()));
  } finally {
    await repository.close();
  }
});
