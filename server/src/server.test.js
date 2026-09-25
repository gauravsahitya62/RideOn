import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createPaymentService } from './payments.js';
import { createAuth } from './auth.js';

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

const testAuth = createAuth({ jwtSecret:'development-only-secret', authEnvironment:'test', accessTokenTtlSeconds:3600, bcryptRounds:4 });
const vendorTokenFor = (customerId) => testAuth.sign({sub:customerId,role:'vendor'});

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

test('legacy JWT rejects wrong issuer, audience, and environment', async () => {
  const baseToken = jwt.sign({sub:crypto.randomUUID(),role:'customer',authEnvironment:'test'}, 'development-only-secret', {expiresIn:3600,issuer:'rideon-api',audience:'rideon-mobile'});
  const wrongIssuer = jwt.sign({sub:crypto.randomUUID(),role:'customer',authEnvironment:'test'}, 'development-only-secret', {expiresIn:3600,issuer:'other-api',audience:'rideon-mobile'});
  const wrongAudience = jwt.sign({sub:crypto.randomUUID(),role:'customer',authEnvironment:'test'}, 'development-only-secret', {expiresIn:3600,issuer:'rideon-api',audience:'other-client'});
  const wrongEnvironment = jwt.sign({sub:crypto.randomUUID(),role:'customer',authEnvironment:'production'}, 'development-only-secret', {expiresIn:3600,issuer:'rideon-api',audience:'rideon-mobile'});
  const valid = await request('/api/v1/bookings', {headers:{authorization:'Bearer '+baseToken}});
  assert.equal(valid.status,200);
  for (const token of [wrongIssuer,wrongAudience,wrongEnvironment]) {
    const response = await request('/api/v1/bookings', {headers:{authorization:'Bearer '+token}});
    assert.equal(response.status,401);
    assert.equal((await response.json()).error.code,'INVALID_TOKEN');
  }
});

test('vehicle image validation rejects MIME-spoofed payloads before storage', async () => {
  const vendor = await register('+911234568001','Upload Validation Vendor');
  await repository.ensureVendorForCustomer(vendor.customer.id);
  const token = vendorTokenFor(vendor.customer.id);
  const response = await jsonRequest('/api/v1/vendor/vehicle-images','POST',{
    contentType:'image/png',
    base64:Buffer.from('not an image').toString('base64'),
  },token);
  assert.equal(response.status,400);
  assert.equal((await response.json()).error.code,'IMAGE_INVALID');
});

test('ordinary booking responses do not expose exact GPS coordinates', async () => {
  const customer = await register('+911234568002','GPS Privacy Customer');
  const login = await legacyLogin('+911234568002');
  const response = await jsonRequest('/api/v1/bookings','POST',{
    vehicleId:'activa-01',
    startAt:'2042-01-10T10:00:00.000Z',
    endAt:'2042-01-11T10:00:00.000Z',
    delivery:true,
    address:'12 GPS Privacy Road, Jaipur',
    deliveryLatitude:26.9124,
    deliveryLongitude:75.7873,
  },login.accessToken,{'Idempotency-Key':'gps-privacy-1'});
  assert.equal(response.status,201);
  const payload=await response.json();
  assert.equal(Object.prototype.hasOwnProperty.call(payload.booking,'deliveryLatitude'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.booking,'deliveryLongitude'),false);
});

test('booking validation caps vehicle identifiers', async () => {
  const customer = await register('+911234568101', 'Vehicle ID Bound User');
  const login = await legacyLogin('+911234568101');
  const response = await jsonRequest('/api/v1/bookings','POST',{
    vehicleId:'x'.repeat(65),
    startAt:'2045-01-10T10:00:00.000Z',
    endAt:'2045-01-11T10:00:00.000Z',
    delivery:false,
    address:'18 Validation Road, Jaipur',
  },login.accessToken);
  assert.equal(response.status,400);
  assert.equal((await response.json()).error.code,'VALIDATION_ERROR');
});

test('delivery GPS is not persisted when delivery is disabled', async () => {
  const customer = await register('+911234568102', 'Pickup Privacy User');
  const login = await legacyLogin('+911234568102');
  const response = await jsonRequest('/api/v1/bookings','POST',{
    vehicleId:'activa-01',
    startAt:'2045-01-12T10:00:00.000Z',
    endAt:'2045-01-13T10:00:00.000Z',
    delivery:false,
    address:'19 Pickup Privacy Road, Jaipur',
    deliveryLatitude:26.9124,
    deliveryLongitude:75.7873,
  },login.accessToken,{'Idempotency-Key':'pickup-privacy-1'});
  assert.equal(response.status,201);
  const bookingId=(await response.json()).booking.bookingId;
  const detail=await request('/api/v1/bookings/'+bookingId,{headers:{authorization:'Bearer '+login.accessToken}});
  const payload=await detail.json();
  assert.equal(detail.status,200);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.booking,'deliveryLatitude'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.booking,'deliveryLongitude'),false);
});

test('vendor customer review history is scoped to the selected booking', async () => {
  const vendorCustomer=await register('+911234568103','Review Privacy Vendor');
  const vendor=await repository.ensureVendorForCustomer(vendorCustomer.customer.id);
  const customer=await register('+911234568104','Review Privacy Customer');
  const customerLogin=await legacyLogin('+911234568104');
  const vehicle=await repository.createVendorVehicle(vendor.id,{type:'car',name:'Privacy Review Car',make:'RideOn',model:'R1',year:2035,city:'Jaipur',dailyRate:1500,securityDeposit:0,transmission:'Automatic',fuel:'Petrol',seats:5,registrationNumber:'RJ14PRV104',description:'Privacy review test vehicle',imageUrls:[],deliveryAvailable:false,active:true});
  const created=await jsonRequest('/api/v1/bookings','POST',{vehicleId:vehicle.id,startAt:'2045-02-10T10:00:00.000Z',endAt:'2045-02-11T10:00:00.000Z',delivery:false,address:'1 Review Privacy Road, Jaipur'},customerLogin.accessToken,{'Idempotency-Key':'review-privacy-a'});
  assert.equal(created.status,201);
  const bookingId=(await created.json()).booking.bookingId;
  const result=await repository.listVendorCustomerReviewsForBooking({vendorId:vendor.id,bookingId});
  assert.deepEqual(result.summary,{averageRating:0,totalReviewCount:0,ratingDistribution:{1:0,2:0,3:0,4:0,5:0}});
  assert.deepEqual(result.reviews,[]);
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

test('vendor rejection requires a reason and cannot be accepted after rejection', async () => {
  const customer=await register('+911234567930','Reject Customer');
  const login=await legacyLogin('+911234567930');
  const vendorCustomer=await register('+911234567931','Reject Vendor');
  const vendor=await repository.ensureVendorForCustomer(vendorCustomer.customer.id);
  const vehicle=await repository.createVendorVehicle(vendor.id,{type:'car',name:'Reject Car',make:'Test',model:'R',year:2034,city:'Jaipur',dailyRate:1000,securityDeposit:500,transmission:'Manual',fuel:'Petrol',seats:5,registrationNumber:'RJ14REJ930',description:'',imageUrls:[],deliveryAvailable:true,active:true});
  const created=await jsonRequest('/api/v1/bookings','POST',{vehicleId:vehicle.id,startAt:'2040-01-10T10:00:00.000Z',endAt:'2040-01-11T10:00:00.000Z',delivery:false,address:'1 Reject Road, Jaipur'},login.accessToken,{ 'Idempotency-Key':'reject-test-930'});
  assert.equal(created.status,201);
  const booking=(await created.json()).booking;
  const vendorToken=vendorTokenFor(vendorCustomer.customer.id);
  const noReason=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/status','PATCH',{status:'rejected'},vendorToken);
  assert.equal(noReason.status,400);
  assert.equal((await noReason.json()).error.code,'REJECTION_REASON_REQUIRED');
  const rejected=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/status','PATCH',{status:'rejected',note:'Vehicle unavailable for requested dates.'},vendorToken);
  assert.equal(rejected.status,200);
  assert.equal((await rejected.json()).booking.status,'rejected');
  const acceptAgain=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/status','PATCH',{status:'confirmed'},vendorToken);
  assert.equal(acceptAgain.status,409);
});

test('security deposit inspection requires completed rental and protects deduction evidence', async () => {
  const customer=await register('+911234567932','Deposit Customer');
  const login=await legacyLogin('+911234567932');
  const vendorCustomer=await register('+911234567933','Deposit Vendor');
  const vendor=await repository.ensureVendorForCustomer(vendorCustomer.customer.id);
  const vehicle=await repository.createVendorVehicle(vendor.id,{type:'car',name:'Deposit Car',make:'Test',model:'D',year:2034,city:'Jaipur',dailyRate:1000,securityDeposit:500,transmission:'Manual',fuel:'Petrol',seats:5,registrationNumber:'RJ14DEP932',description:'',imageUrls:[],deliveryAvailable:true,active:true});
  const created=await jsonRequest('/api/v1/bookings','POST',{vehicleId:vehicle.id,startAt:'2040-02-10T10:00:00.000Z',endAt:'2040-02-11T10:00:00.000Z',delivery:false,address:'2 Deposit Road, Jaipur'},login.accessToken,{ 'Idempotency-Key':'deposit-test-932'});
  const booking=(await created.json()).booking;
  const vendorToken=vendorTokenFor(vendorCustomer.customer.id);
  const beforeReturn=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/security-deposit/inspection','POST',{deductionPaise:0},vendorToken);
  assert.equal(beforeReturn.status,409);
  await repository.updateVendorBookingStatus(vendor.id,booking.bookingId,'confirmed');
  const payment=await repository.createOrGetPaymentOrder({bookingId:booking.bookingId,customerId:customer.customer.id,provider:'mock',amountPaise:Math.round(booking.pricing.total*100),currency:'INR',providerOrder:{id:'deposit-order-'+booking.bookingId,amountPaise:Math.round(booking.pricing.total*100),currency:'INR'}});
  await repository.applyPaymentEvent({eventId:'deposit-paid-'+booking.bookingId,bookingId:booking.bookingId,providerReference:'deposit-paid-ref-'+booking.bookingId,providerOrderId:payment.payment.providerOrderId,amountPaise:payment.payment.amountPaise,currency:'INR',status:'paid'});
  await repository.updateVendorBookingStatus(vendor.id,booking.bookingId,'in_progress');
  await repository.updateVendorBookingStatus(vendor.id,booking.bookingId,'completed');
  const missingEvidence=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/security-deposit/inspection','POST',{deductionPaise:10000,reason:'Damage'},vendorToken);
  assert.equal(missingEvidence.status,400);
  assert.equal((await missingEvidence.json()).error.code,'DEPOSIT_EVIDENCE_REQUIRED');
  const valid=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/security-deposit/inspection','POST',{deductionPaise:10000,reason:'Damage',evidenceReference:'inspection-photo-932'},vendorToken);
  assert.equal(valid.status,400);
  assert.equal((await valid.json()).error.code,'DEPOSIT_DEDUCTION_INVALID');
  const release=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/security-deposit/inspection','POST',{deductionPaise:0},vendorToken);
  assert.equal(release.status,200);
  assert.equal((await release.json()).deposit.status,'refund_pending');
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
  const bookingPayload = await bookingResponse.json();
  const bookingId = bookingPayload.booking.bookingId;
  const bookingForPayment = await repository.getBooking(bookingId, customer.customer.id);
  await repository.createOrGetPaymentOrder({bookingId,customerId:customer.customer.id,provider:'mock',amountPaise:Math.round(bookingForPayment.pricing.total*100),currency:'INR',providerOrder:{id:'test-vendor-lifecycle-'+bookingId,amountPaise:Math.round(bookingForPayment.pricing.total*100),currency:'INR'}});
  await repository.applyPaymentEvent({eventId:'paid-vendor-lifecycle-'+bookingId,bookingId,paymentId:undefined,providerReference:'paid-vendor-lifecycle-ref-'+bookingId,providerOrderId:'test-vendor-lifecycle-'+bookingId,amountPaise:Math.round(bookingForPayment.pricing.total*100),currency:'INR',status:'paid'});

  const vendorAToken = vendorTokenFor(vendorCustomer.customer.id);
  const vendorBToken = vendorTokenFor(otherVendorCustomer.customer.id);

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

test('active delivery tracking is vendor-authorized and stops on delivery completion', async () => {
  const customer=await register('+911234567930','Tracking Customer');
  const customerLogin=await legacyLogin('+911234567930');
  const otherCustomer=await register('+911234567931','Other Tracking Customer');
  const otherLogin=await legacyLogin('+911234567931');
  const vendorCustomer=await register('+911234567932','Tracking Vendor');
  const vendor=await repository.ensureVendorForCustomer(vendorCustomer.customer.id);
  const vehicle=await repository.createVendorVehicle(vendor.id,{type:'car',name:'Tracking Car',make:'Test',model:'T',year:2034,city:'Jaipur',dailyRate:1500,securityDeposit:0,transmission:'Automatic',fuel:'Petrol',seats:5,registrationNumber:'RJTRACK930',description:'Tracking vehicle',imageUrls:[],deliveryAvailable:true,active:true});
  const bookingResponse=await jsonRequest('/api/v1/bookings','POST',{vehicleId:vehicle.id,startAt:'2036-07-10T10:00:00.000Z',endAt:'2036-07-11T10:00:00.000Z',delivery:true,address:'10 Tracking Road, Jaipur',deliveryLatitude:26.9124,deliveryLongitude:75.7873},customerLogin.accessToken,{'Idempotency-Key':'tracking-booking-1'});
  assert.equal(bookingResponse.status,201);
  const booking=(await bookingResponse.json()).booking;
  const payment=await repository.createOrGetPaymentOrder({bookingId:booking.bookingId,customerId:customer.customer.id,provider:'mock',amountPaise:Math.round(booking.pricing.total*100),currency:'INR',providerOrder:{id:'tracking-order-'+booking.bookingId,amountPaise:Math.round(booking.pricing.total*100),currency:'INR'}});
  await repository.applyPaymentEvent({eventId:'tracking-paid-'+booking.bookingId,bookingId:booking.bookingId,paymentId:payment.id,providerReference:'tracking-ref-'+booking.bookingId,providerOrderId:'tracking-order-'+booking.bookingId,amountPaise:payment.amountPaise,currency:'INR',status:'paid'});
  const vendorToken=vendorTokenFor(vendorCustomer.customer.id);
  assert.equal((await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/status','PATCH',{status:'confirmed'},vendorToken)).status,200);
  const otherTrack=await request('/api/v1/bookings/'+booking.bookingId+'/tracking',{headers:{authorization:'Bearer '+otherLogin.accessToken}});
  assert.equal(otherTrack.status,404);
  const started=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/delivery/start','POST',{},vendorToken);
  assert.equal(started.status,200);
  const duplicate=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/delivery/start','POST',{},vendorToken);
  assert.equal(duplicate.status,409);
  const update=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/delivery/location','POST',{latitude:26.913,longitude:75.788,accuracyMeters:12},vendorToken);
  assert.equal(update.status,200);
  const tracking=await request('/api/v1/bookings/'+booking.bookingId+'/tracking',{headers:{authorization:'Bearer '+customerLogin.accessToken}});
  assert.equal(tracking.status,200);
  const trackingPayload=await tracking.json();
  assert.equal(trackingPayload.tracking.active,true);
  assert.equal(trackingPayload.tracking.session.lastLatitude,26.913);
  const completed=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/delivery/complete','POST',{latitude:26.914,longitude:75.789},vendorToken);
  assert.equal(completed.status,200);
  const after=await request('/api/v1/bookings/'+booking.bookingId+'/tracking',{headers:{authorization:'Bearer '+customerLogin.accessToken}});
  assert.equal(after.status,200);
  const afterPayload=await after.json();
  assert.equal(afterPayload.tracking.active,false);
  assert.equal(afterPayload.tracking.booking.deliveryStatus,'delivered');
  const lateUpdate=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/delivery/location','POST',{latitude:26.915,longitude:75.790},vendorToken);
  assert.equal(lateUpdate.status,409);
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

test('vendor service location is vendor-only and persists', async () => {
  const vendorCustomer=await register('+911234567940','Maps Vendor');
  const login=await legacyLogin('+911234567940');
  const vendor=await repository.ensureVendorForCustomer(vendorCustomer.customer.id);
  const token=vendorTokenFor(vendorCustomer.customer.id);
  const saved=await jsonRequest('/api/v1/vendor/service-location','PATCH',{latitude:26.91,longitude:75.79,address:'RideOn Service Point',serviceCity:'Jaipur'},token);
  assert.equal(saved.status,200);
  const savedPayload=await saved.json();
  assert.equal(savedPayload.location.latitude,26.91);
  const loaded=await request('/api/v1/vendor/service-location',{headers:{authorization:'Bearer '+token}});
  assert.equal(loaded.status,200);
  const loadedPayload=await loaded.json();
  assert.equal(loadedPayload.location.address,'RideOn Service Point');
  const customerToken=login.accessToken;
  const forbidden=await request('/api/v1/vendor/service-location',{headers:{authorization:'Bearer '+customerToken}});
  assert.equal(forbidden.status,403);
  assert.ok(vendor.id);
});

test('marketplace vendor map groups active vehicles by service location', async () => {
  const vendorCustomer=await register('+911234567941','Map Vendor Two');
  const vendor=await repository.ensureVendorForCustomer(vendorCustomer.customer.id);
  const token=vendorTokenFor(vendorCustomer.customer.id);
  const saved=await jsonRequest('/api/v1/vendor/service-location','PATCH',{latitude:26.91,longitude:75.79,address:'Service Point Two',serviceCity:'Jaipur'},token);
  assert.equal(saved.status,200);
  await repository.createVendorVehicle(vendor.id,{type:'car',name:'Map Car A',make:'Test',model:'A',year:2034,city:'Jaipur',dailyRate:1000,securityDeposit:0,transmission:'Manual',fuel:'Petrol',seats:5,registrationNumber:'RJMAP941A',description:'',imageUrls:[],deliveryAvailable:true,active:true});
  await repository.createVendorVehicle(vendor.id,{type:'car',name:'Map Car B',make:'Test',model:'B',year:2034,city:'Jaipur',dailyRate:1200,securityDeposit:0,transmission:'Manual',fuel:'Petrol',seats:5,registrationNumber:'RJMAP941B',description:'',imageUrls:[],deliveryAvailable:true,active:true});
  const map=await request('/api/v1/vendors/map?city=Jaipur');
  assert.equal(map.status,200);
  const payload=await map.json();
  const found=payload.vendors.find(v=>v.vendorId===vendor.id);
  assert.ok(found);
  assert.equal(found.availableVehicleCount,2);
});

test('route preview returns a friendly configuration error when routing is not configured', async () => {
  await register('+911234567942','Route User');
  const login=await legacyLogin('+911234567942');
  const vendorCustomer=await register('+911234567943','Route Vendor');
  const vendor=await repository.ensureVendorForCustomer(vendorCustomer.customer.id);
  const vendorToken=vendorTokenFor(vendorCustomer.customer.id);
  const saved=await jsonRequest('/api/v1/vendor/service-location','PATCH',{latitude:26.91,longitude:75.79,address:'Route Service Point',serviceCity:'Jaipur'},vendorToken);
  assert.equal(saved.status,200);
  const vehicle=await repository.createVendorVehicle(vendor.id,{type:'car',name:'Route Car',make:'Test',model:'R',year:2034,city:'Jaipur',dailyRate:1000,securityDeposit:0,transmission:'Manual',fuel:'Petrol',seats:5,registrationNumber:'RJROUTE942',description:'',imageUrls:[],deliveryAvailable:true,active:true});
  const response=await jsonRequest('/api/v1/routing/eta','GET',{},login.accessToken);
  assert.equal(response.status,400);
  await customer.customer.id;
  assert.ok(vehicle.id);
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


test('refund requests are server-side idempotent', async () => {
  const user = await register('+911234567921', 'Refund Idempotency User');
  const login = await legacyLogin('+911234567921');
  const created = await jsonRequest('/api/v1/bookings','POST',{
    vehicleId:'activa-01',startAt:'2038-01-10T10:00:00.000Z',endAt:'2038-01-11T10:00:00.000Z',
    delivery:false,address:'18 Refund Road, Jaipur',
  },login.accessToken,{ 'Idempotency-Key':'refund-idempotency-booking' });
  const booking=(await created.json()).booking;
  const amountPaise=Math.round(booking.pricing.total*100);
  await repository.createOrGetPaymentOrder({bookingId:booking.bookingId,customerId:user.customer.id,provider:'mock',amountPaise,currency:'INR',providerOrder:{id:'refund-order-'+booking.bookingId,amountPaise,currency:'INR'}});
  await repository.applyPaymentEvent({eventId:'refund-paid-'+booking.bookingId,bookingId:booking.bookingId,providerReference:'refund-paid-ref-'+booking.bookingId,providerOrderId:'refund-order-'+booking.bookingId,amountPaise,currency:'INR',status:'paid'});
  const first=await repository.claimRefundRequest((await repository.findPaymentByBooking(booking.bookingId)).id);
  const second=await repository.claimRefundRequest((await repository.findPaymentByBooking(booking.bookingId)).id);
  assert.equal(first.created,true);
  assert.equal(second.created,false);
  assert.equal(second.idempotencyKey,first.idempotencyKey);
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

test('unconfigured provider exposes no customer UPI methods and fails closed', async () => {
  const service = createPaymentService({ provider:'unconfigured' });
  assert.equal(service.configured,false);
  assert.equal(service.capabilities.supportsIntent,false);
  assert.equal(service.capabilities.supportsVpa,false);
  assert.deepEqual(service.capabilities.apps,[]);
  await assert.rejects(() => service.createCustomerPayment({orderId:'rideon-test',amountPaise:10000}), error => error.code==='PAYMENT_PROVIDER_CONFIGURATION_REQUIRED');
});

test('mock provider never reports authoritative payment success', async () => {
  const service = createPaymentService({ provider:'mock' });
  const verification = await service.verifyPayment({providerOrderId:'order-1',providerPaymentId:'pay-1',amountPaise:10000});
  assert.equal(verification.verified,false);
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


test('reviews enforce completed booking ownership, duplicate prevention, and server aggregation', async () => {
  const customer=await register('+911234567941','Reviews Customer');
  const customerLogin=await legacyLogin('+911234567941');
  const other=await register('+911234567942','Other Customer');
  const otherLogin=await legacyLogin('+911234567942');
  const vendorCustomer=await register('+911234567943','Reviews Vendor');
  const vendor=await repository.ensureVendorForCustomer(vendorCustomer.customer.id);
  const vehicle=await repository.createVendorVehicle(vendor.id,{type:'car',name:'Reviews Car',make:'RideOn',model:'R1',year:2035,city:'Jaipur',dailyRate:1500,securityDeposit:0,transmission:'Automatic',fuel:'Petrol',seats:5,registrationNumber:'RJ14REV941',description:'Reviews test vehicle',imageUrls:[],deliveryAvailable:false,active:true});
  const created=await jsonRequest('/api/v1/bookings','POST',{vehicleId:vehicle.id,startAt:'2042-01-10T10:00:00.000Z',endAt:'2042-01-11T10:00:00.000Z',delivery:false,address:'1 Reviews Road, Jaipur'},customerLogin.accessToken,{'Idempotency-Key':'reviews-booking-941'});
  assert.equal(created.status,201);
  const booking=(await created.json()).booking;
  const vendorToken=vendorTokenFor(vendorCustomer.customer.id);

  const beforeComplete=await jsonRequest('/api/v1/bookings/'+booking.bookingId+'/reviews/customer','POST',{rating:5,comment:'Too early'},customerLogin.accessToken);
  assert.equal(beforeComplete.status,409);
  assert.equal((await beforeComplete.json()).error.code,'REVIEW_NOT_ELIGIBLE');

  const payment=await repository.createOrGetPaymentOrder({bookingId:booking.bookingId,customerId:customer.customer.id,provider:'mock',amountPaise:Math.round(booking.pricing.total*100),currency:'INR',providerOrder:{id:'review-order-'+booking.bookingId,amountPaise:Math.round(booking.pricing.total*100),currency:'INR'}});
  await repository.applyPaymentEvent({eventId:'review-paid-'+booking.bookingId,bookingId:booking.bookingId,providerReference:'review-paid-ref-'+booking.bookingId,providerOrderId:payment.payment.providerOrderId,amountPaise:payment.payment.amountPaise,currency:'INR',status:'paid'});
  await repository.updateVendorBookingStatus(vendor.id,booking.bookingId,'confirmed');
  await repository.updateVendorBookingStatus(vendor.id,booking.bookingId,'in_progress');
  await repository.updateVendorBookingStatus(vendor.id,booking.bookingId,'completed');

  const invalid=await jsonRequest('/api/v1/bookings/'+booking.bookingId+'/reviews/customer','POST',{rating:6},customerLogin.accessToken);
  assert.equal(invalid.status,400);
  assert.equal((await invalid.json()).error.code,'INVALID_REVIEW');

  const foreign=await jsonRequest('/api/v1/bookings/'+booking.bookingId+'/reviews/customer','POST',{rating:5},otherLogin.accessToken);
  assert.equal(foreign.status,404);

  const longComment=await jsonRequest('/api/v1/bookings/'+booking.bookingId+'/reviews/customer','POST',{rating:5,comment:'x'.repeat(1001)},customerLogin.accessToken);
  assert.equal(longComment.status,400);

  const customerReview=await jsonRequest('/api/v1/bookings/'+booking.bookingId+'/reviews/customer','POST',{rating:5,comment:'Excellent vehicle and smooth rental.'},customerLogin.accessToken);
  assert.equal(customerReview.status,201);
  assert.equal((await customerReview.json()).review.rating,5);

  const duplicate=await jsonRequest('/api/v1/bookings/'+booking.bookingId+'/reviews/customer','POST',{rating:4,comment:'Second review'},customerLogin.accessToken);
  assert.equal(duplicate.status,409);
  assert.equal((await duplicate.json()).error.code,'REVIEW_ALREADY_EXISTS');

  const vendorReview=await jsonRequest('/api/v1/vendor/bookings/'+booking.bookingId+'/review','POST',{rating:4,comment:'Responsible customer.'},vendorToken);
  assert.equal(vendorReview.status,201);
  assert.equal((await vendorReview.json()).review.rating,4);

  const status=await request('/api/v1/bookings/'+booking.bookingId+'/reviews/status',{headers:{authorization:'Bearer '+customerLogin.accessToken}});
  const statusPayload=await status.json();
  assert.equal(status.status,200);
  assert.equal(statusPayload.data.eligible,true);
  assert.equal(statusPayload.data.review.rating,5);

  const vehicleReviews=await request('/api/v1/vehicles/'+vehicle.id+'/reviews',{headers:{authorization:'Bearer '+customerLogin.accessToken}});
  const vehiclePayload=await vehicleReviews.json();
  assert.equal(vehicleReviews.status,200);
  assert.equal(vehiclePayload.summary.totalReviewCount,1);
  assert.equal(vehiclePayload.summary.averageRating,5);
  assert.equal(vehiclePayload.summary.ratingDistribution[5],1);
  assert.equal(vehiclePayload.reviews[0].reviewType,'customer_to_vendor');

  const vendorReviews=await request('/api/v1/vendors/'+vendor.id+'/reviews',{headers:{authorization:'Bearer '+customerLogin.accessToken}});
  const vendorPayload=await vendorReviews.json();
  assert.equal(vendorReviews.status,200);
  assert.equal(vendorPayload.summary.totalReviewCount,1);
  assert.equal(vendorPayload.summary.averageRating,5);

  const customerHistory=await request('/api/v1/vendor/bookings/'+booking.bookingId+'/customer-reviews',{headers:{authorization:'Bearer '+vendorToken}});
  const historyPayload=await customerHistory.json();
  assert.equal(customerHistory.status,200);
  assert.equal(historyPayload.summary.totalReviewCount,1);
  assert.equal(historyPayload.reviews[0].rating,4);

  const vendorEdit=await jsonRequest('/api/v1/reviews/'+historyPayload.reviews[0].id,'PATCH',{rating:2},vendorToken);
  assert.equal(vendorEdit.status,403);
  assert.equal((await vendorEdit.json()).error.code,'FORBIDDEN');

  const edited=await jsonRequest('/api/v1/reviews/'+statusPayload.data.review.id,'PATCH',{rating:3,comment:'Updated after thinking it over.'},customerLogin.accessToken);
  assert.equal(edited.status,200);
  assert.equal((await edited.json()).review.rating,3);
});




test('support tickets enforce ownership, booking scoping, messaging and lifecycle', async () => {
  const customer=await register('+911234568001','Support Customer');
  const customerLogin=await legacyLogin('+911234568001');
  const other=await register('+911234568002','Other Support Customer');
  const otherLogin=await legacyLogin('+911234568002');

  const invalid=await jsonRequest('/api/v1/support/tickets','POST',{category:'Not real',subject:'Payment issue',description:'Something went wrong with payment.'},customerLogin.accessToken);
  assert.equal(invalid.status,400);

  const created=await jsonRequest('/api/v1/support/tickets','POST',{category:'Payment',subject:'Payment verification issue',description:'My payment is not showing as confirmed.',priority:'high'},customerLogin.accessToken,{'Idempotency-Key':'support-test-key-001'});
  assert.equal(created.status,201);
  const ticketPayload=await created.json();
  assert.ok(ticketPayload.ticket.id);
  assert.match(ticketPayload.ticket.ticketNumber,/^RID-/);
  assert.equal(ticketPayload.ticket.status,'open');

  const replay=await jsonRequest('/api/v1/support/tickets','POST',{category:'Payment',subject:'Changed subject should not duplicate',description:'This retry must remain idempotent.',priority:'urgent'},customerLogin.accessToken,{'Idempotency-Key':'support-test-key-001'});
  assert.equal(replay.status,200);
  assert.equal((await replay.json()).ticket.id,ticketPayload.ticket.id);

  const foreign=await request('/api/v1/support/tickets/'+ticketPayload.ticket.id,{headers:{authorization:'Bearer '+otherLogin.accessToken}});
  assert.equal(foreign.status,404);

  const foreignMessage=await jsonRequest('/api/v1/support/tickets/'+ticketPayload.ticket.id+'/messages','POST',{message:'I should not access this ticket.'},otherLogin.accessToken);
  assert.equal(foreignMessage.status,404);

  const message=await jsonRequest('/api/v1/support/tickets/'+ticketPayload.ticket.id+'/messages','POST',{message:'Here is an additional detail for support.'},customerLogin.accessToken);
  assert.equal(message.status,201);

  const messages=await request('/api/v1/support/tickets/'+ticketPayload.ticket.id+'/messages',{headers:{authorization:'Bearer '+customerLogin.accessToken}});
  assert.equal(messages.status,200);
  assert.equal((await messages.json()).messages.length,1);

  const closed=await jsonRequest('/api/v1/support/tickets/'+ticketPayload.ticket.id+'/close','POST',{},customerLogin.accessToken);
  assert.equal(closed.status,200);
  assert.equal((await closed.json()).ticket.status,'closed');

  const closedReply=await jsonRequest('/api/v1/support/tickets/'+ticketPayload.ticket.id+'/messages','POST',{message:'This should be blocked while closed.'},customerLogin.accessToken);
  assert.equal(closedReply.status,409);

  const reopened=await jsonRequest('/api/v1/support/tickets/'+ticketPayload.ticket.id+'/reopen','POST',{},customerLogin.accessToken);
  assert.equal(reopened.status,200);
  assert.equal((await reopened.json()).ticket.status,'open');

  const listed=await request('/api/v1/support/tickets',{headers:{authorization:'Bearer '+customerLogin.accessToken}});
  assert.equal(listed.status,200);
  assert.ok((await listed.json()).tickets.some(t=>t.id===ticketPayload.ticket.id));

  const booking=await jsonRequest('/api/v1/bookings','POST',{
    vehicleId:'activa-01',
    startAt:'2044-01-10T10:00:00.000Z',
    endAt:'2044-01-11T10:00:00.000Z',
    delivery:false,
    address:'18 Support Road, Jaipur',
  },customerLogin.accessToken,{'Idempotency-Key':'support-booking-001'});
  assert.equal(booking.status,201);
  const bookingId=(await booking.json()).booking.bookingId;

  const foreignBookingTicket=await jsonRequest('/api/v1/support/tickets','POST',{
    bookingId,
    category:'Booking',
    subject:'Foreign booking',
    description:'This must not be linked to another customer booking.',
  },otherLogin.accessToken,{'Idempotency-Key':'support-foreign-booking'});
  assert.equal(foreignBookingTicket.status,404);
});

test('support staff can inspect, assign and transition tickets while internal messages stay private', async () => {
  const customer=await register('+911234568003','Support Admin Customer');
  const customerLogin=await legacyLogin('+911234568003');
  const created=await jsonRequest('/api/v1/support/tickets','POST',{category:'Technical Issue',subject:'App issue',description:'The support flow needs assistance.'},customerLogin.accessToken,{'Idempotency-Key':'support-admin-key-003'});
  assert.equal(created.status,201);
  const ticket=(await created.json()).ticket;

  const supportEmail='support-role-test@example.com';
  const support=await repository.createOrLinkCustomerFromSupabase({
    supabaseUserId:crypto.randomUUID(),email:supportEmail,fullName:'RideOn Support',phone:'+911234568004',role:'support'
  });
  assert.equal(support.role,'support');
  const supportToken=jwt.sign({sub:support.id,role:'support'},'development-only-secret');

  const adminList=await request('/api/v1/support/admin/tickets',{headers:{authorization:'Bearer '+supportToken}});
  assert.equal(adminList.status,200);
  assert.ok((await adminList.json()).tickets.some(t=>t.id===ticket.id));

  const internal=await jsonRequest('/api/v1/support/admin/tickets/'+ticket.id+'/messages','POST',{message:'Internal triage note.',isInternal:true},supportToken);
  assert.equal(internal.status,201);

  const customerMessages=await request('/api/v1/support/tickets/'+ticket.id+'/messages',{headers:{authorization:'Bearer '+customerLogin.accessToken}});
  const customerMessagesPayload=await customerMessages.json();
  assert.equal(customerMessages.status,200);
  assert.equal(customerMessagesPayload.messages.some(m=>m.message==='Internal triage note.'),false);

  const assign=await jsonRequest('/api/v1/support/admin/tickets/'+ticket.id+'/assignment','PATCH',{assignedToUserId:support.id},supportToken);
  assert.equal(assign.status,200);

  const status=await jsonRequest('/api/v1/support/admin/tickets/'+ticket.id+'/status','PATCH',{status:'in_progress'},supportToken);
  assert.equal(status.status,200);
  assert.equal((await status.json()).ticket.status,'in_progress');

  const resolved=await jsonRequest('/api/v1/support/admin/tickets/'+ticket.id+'/resolve','POST',{resolution:'Issue reviewed by RideOn support.'},supportToken);
  assert.equal(resolved.status,200);
  assert.equal((await resolved.json()).ticket.status,'resolved');

  const reopened=await jsonRequest('/api/v1/support/tickets/'+ticket.id+'/reopen','POST',{},customerLogin.accessToken);
  assert.equal(reopened.status,200);
  assert.equal((await reopened.json()).ticket.status,'open');
});


test('vendor public fleet returns only active vehicles for that vendor', async () => {
  const vendorCustomer=await register('+911234569001','Fleet Vendor A');
  const vendor=await repository.ensureVendorForCustomer(vendorCustomer.customer.id,{businessName:'Fleet Vendor A'});
  await repository.createVendorVehicle(vendor.id,{type:'car',name:'Fleet Car A',make:'RideOn',model:'A',year:2035,city:'Udaipur',dailyRate:1200,securityDeposit:0,registrationNumber:'RJ14FLEET001',description:'A',imageUrls:[],deliveryAvailable:true,active:true});
  await repository.createVendorVehicle(vendor.id,{type:'bike',name:'Fleet Bike Inactive',make:'RideOn',model:'B',year:2035,city:'Udaipur',dailyRate:500,securityDeposit:0,registrationNumber:'RJ14FLEET002',description:'B',imageUrls:[],deliveryAvailable:true,active:false});
  const token=await legacyLogin('+911234569001');
  // Public fleet route is intentionally public; authorization is enforced by returned active vendor data.
  const response=await request('/api/v1/vendors/'+vendor.id+'/vehicles');
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.vehicles.length,1);
  assert.equal(payload.vehicles[0].name,'Fleet Car A');
});

test('multi-vehicle quote rejects vehicles from another vendor', async () => {
  const va=await register('+911234569002','Quote Vendor A');
  const vb=await register('+911234569003','Quote Vendor B');
  const vendorA=await repository.ensureVendorForCustomer(va.customer.id);
  const vendorB=await repository.ensureVendorForCustomer(vb.customer.id);
  const a=await repository.createVendorVehicle(vendorA.id,{type:'car',name:'Quote A',make:'RideOn',model:'A',year:2035,city:'Udaipur',dailyRate:1000,securityDeposit:0,registrationNumber:'RJ14QUOTE01',description:'A',imageUrls:[],deliveryAvailable:false,active:true});
  const b=await repository.createVendorVehicle(vendorB.id,{type:'car',name:'Quote B',make:'RideOn',model:'B',year:2035,city:'Udaipur',dailyRate:1000,securityDeposit:0,registrationNumber:'RJ14QUOTE02',description:'B',imageUrls:[],deliveryAvailable:false,active:true});
  const customer=await register('+911234569004','Quote Customer');
  const login=await legacyLogin('+911234569004');
  const response=await jsonRequest('/api/v1/quotes/multi','POST',{vendorId:vendorA.id,vehicleIds:[a.id,b.id],pickupAt:'2045-03-10T10:00:00.000Z',returnAt:'2045-03-12T10:00:00.000Z',delivery:false,address:'Self pickup'},login.accessToken);
  assert.equal(response.status,403);
  assert.equal((await response.json()).error.code,'MULTI_VEHICLE_ACCESS_DENIED');
});

test('multi-vehicle checkout creates one grouped order atomically and is idempotent', async () => {
  const vc=await register('+911234569005','Atomic Fleet Vendor');
  const vendor=await repository.ensureVendorForCustomer(vc.customer.id);
  const one=await repository.createVendorVehicle(vendor.id,{type:'car',name:'Atomic One',make:'RideOn',model:'1',year:2035,city:'Udaipur',dailyRate:1000,securityDeposit:100,registrationNumber:'RJ14ATOMIC01',description:'1',imageUrls:[],deliveryAvailable:false,active:true});
  const two=await repository.createVendorVehicle(vendor.id,{type:'car',name:'Atomic Two',make:'RideOn',model:'2',year:2035,city:'Udaipur',dailyRate:1500,securityDeposit:200,registrationNumber:'RJ14ATOMIC02',description:'2',imageUrls:[],deliveryAvailable:false,active:true});
  const customer=await register('+911234569006','Atomic Customer');
  const login=await legacyLogin('+911234569006');
  const base={vendorId:vendor.id,vehicleIds:[one.id,two.id],pickupAt:'2045-04-10T10:00:00.000Z',returnAt:'2045-04-12T10:00:00.000Z',delivery:false,address:'Self pickup'};
  const first=await jsonRequest('/api/v1/fleet-orders','POST',base,login.accessToken,{'Idempotency-Key':'atomic-fleet-001'});
  assert.equal(first.status,201);
  const firstPayload=await first.json();
  assert.equal(firstPayload.order.items.length,2);
  const replay=await jsonRequest('/api/v1/fleet-orders','POST',base,login.accessToken,{'Idempotency-Key':'atomic-fleet-001'});
  assert.equal(replay.status,201);
  assert.equal((await replay.json()).order.id,firstPayload.order.id);
  const invalid=await jsonRequest('/api/v1/quotes/multi','POST',{...base,vehicleIds:[one.id,'does-not-belong']},login.accessToken);
  assert.equal(invalid.status,403);
});

test('multi-vehicle checkout rolls back all staged bookings when a selected vehicle becomes unavailable', async () => {
  const vc=await register('+911234569007','Rollback Fleet Vendor');
  const vendor=await repository.ensureVendorForCustomer(vc.customer.id);
  const one=await repository.createVendorVehicle(vendor.id,{type:'car',name:'Rollback One',make:'RideOn',model:'1',year:2035,city:'Udaipur',dailyRate:1000,securityDeposit:0,registrationNumber:'RJ14ROLL001',description:'1',imageUrls:[],deliveryAvailable:false,active:true});
  const two=await repository.createVendorVehicle(vendor.id,{type:'car',name:'Rollback Two',make:'RideOn',model:'2',year:2035,city:'Udaipur',dailyRate:1500,securityDeposit:0,registrationNumber:'RJ14ROLL002',description:'2',imageUrls:[],deliveryAvailable:false,active:true});
  const customer=await register('+911234569008','Rollback Customer');
  const futureStart='2045-05-10T10:00:00.000Z',futureEnd='2045-05-12T10:00:00.000Z';
  const result=await repository.quoteMultiVehicle({customerId:customer.customer.id,vendorId:vendor.id,vehicleIds:[one.id,two.id],startAt:futureStart,endAt:futureEnd,delivery:false});
  assert.equal(result.items.length,2);
  const competing=await repository.createBooking({customerId:customer.customer.id,vehicle:two,startAt:futureStart,endAt:futureEnd,delivery:false,address:'Self pickup',pricing:{days:2,rental:3000,deliveryFee:0,platformFee:150,securityDeposit:0,total:3150,currency:'INR',currencyUnit:'rupees'},notes:null,idempotencyKey:'rollback-competing'});
  assert.ok(competing.id);
  await assert.rejects(()=>repository.createFleetOrder({customerId:customer.customer.id,vendorId:vendor.id,vehicleIds:[one.id,two.id],startAt:futureStart,endAt:futureEnd,delivery:false,address:'Self pickup'}),e=>e.code==='MULTI_VEHICLE_UNAVAILABLE');
});

test.after(async () => {
  try {
    if (server?.listening) await new Promise((resolve) => server.close(() => resolve()));
  } finally {
    await repository.close();
  }
});
