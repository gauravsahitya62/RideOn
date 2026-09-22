import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { createRepository } from './repository.js';
import { createAuth } from './auth.js';
import { createPaymentService } from './payments.js';

const fleet = [];

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.disable('x-powered-by');
const allowedOrigin = process.env.CLIENT_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin === '*' ? true : allowedOrigin }));
app.use(express.json({ limit: '32kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
const authRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' });

const bookingSchema = z.object({
  customerName: z.string().trim().min(2).max(100).optional().default('RideOn guest'),
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional(),
  vehicleId: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  delivery: z.boolean().default(true),
  address: z.string().trim().min(8).max(300),
  notes: z.string().max(500).optional(),
}).refine((x) => new Date(x.endAt) > new Date(x.startAt), { message: 'endAt must be after startAt', path: ['endAt'] });

function normalizeBookingInput(body = {}) {
  if (body.startAt && body.endAt) return body;
  const days = Math.max(1, Math.min(30, Number(body.durationDays) || 1));
  if (typeof body.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) return body;
  const start = new Date(`${body.startDate}T10:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== body.startDate) return body;
  return { ...body, startAt: start.toISOString(), endAt: new Date(start.getTime() + days * 86400000).toISOString() };
}

function pricing(vehicle, startAt, endAt, delivery) {
  const days = Math.max(1, Math.ceil((new Date(endAt) - new Date(startAt)) / 86400000));
  const rental = vehicle.pricePerDay * days;
  const deliveryFee = delivery ? 199 : 0;
  const platformFee = Math.round(rental * 0.05);
  return { days, rental, deliveryFee, platformFee, total: rental + deliveryFee + platformFee, currency: 'INR', currencyUnit: 'rupees' };
}

const mobileVehicle = (v) => ({
  ...v,
  price: v.pricePerDay,
  detail: v.subtitle,
  emoji: v.type === 'car' ? '🚘' : '🏍️',
  color: v.type === 'car' ? '#E7E9EF' : '#F2E7DA',
  tag: 'Available',
});

function publicBooking(booking) {
  return {
    id: booking.id,
    bookingId: booking.id,
    vehicleId: booking.vehicleId,
    vehicleName: booking.vehicle?.name,
    vehicle: booking.vehicle,
    startAt: booking.startAt,
    endAt: booking.endAt,
    delivery: booking.delivery,
    address: booking.address,
    notes: booking.notes,
    pricing: booking.pricing,
    totalPrice: booking.pricing.total,
    total: booking.pricing.total,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt || booking.createdAt,
  };
}

const repository = createRepository({ databaseUrl: process.env.DATABASE_URL, fleet });
const paymentProvider = process.env.PAYMENT_PROVIDER || 'unconfigured';
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
if (process.env.NODE_ENV === 'production' && (!process.env.CLIENT_ORIGIN || process.env.CLIENT_ORIGIN === '*')) throw new Error('CLIENT_ORIGIN must be explicitly configured in production');
if (process.env.NODE_ENV === 'production' && paymentProvider !== 'unconfigured') throw new Error('No production payment provider adapter is configured');

function normalizeOtpDestination({ channel, value }) {
  const raw = String(value || '').trim();
  if (channel === 'email') return raw.toLowerCase();
  const compact = raw.replace(/\s+/g, '');
  if (!/^\+?[0-9]{10,15}$/.test(compact)) return null;
  return compact;
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashOtpCode(code) {
  return auth.hashPassword(code);
}

async function deliverOtp({ channel, destination, code }) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[rideon-otp] ' + channel + ' ' + destination + ': ' + code);
    return { delivered: true, developmentCode: code };
  }
  if (channel === 'email' && process.env.RESEND_API_KEY && process.env.OTP_FROM_EMAIL) {
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{Authorization:'Bearer ' + process.env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        from:process.env.OTP_FROM_EMAIL,
        to:[destination],
        subject:'Your RideOn verification code',
        text:'Your RideOn verification code is ' + code + '. It expires in 10 minutes.'
      })
    });
    if (!response.ok) throw new Error('OTP delivery failed');
    return { delivered:true };
  }
  if (channel === 'phone' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_PHONE) {
    const body=new URLSearchParams({
      To:destination,
      From:process.env.TWILIO_FROM_PHONE,
      Body:'Your RideOn verification code is ' + code + '. It expires in 10 minutes.'
    });
    const basic=Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64');
    const response=await fetch(
      'https://api.twilio.com/2010-04-01/Accounts/' + process.env.TWILIO_ACCOUNT_SID + '/Messages.json',
      {method:'POST',headers:{Authorization:'Basic ' + basic,'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()}
    );
    if(!response.ok) throw new Error('OTP delivery failed');
    return { delivered:true };
  }
  throw new Error('OTP delivery service is not configured for this channel.');
}

const auth = createAuth({
  jwtSecret: process.env.JWT_SECRET,
  accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 3600),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
});
const payments = createPaymentService({
  provider: paymentProvider,
  webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET,
});


async function verifySupabaseAccessToken(token) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) throw new Error('Supabase Auth is not configured');
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: publishableKey },
  });
  if (!response.ok) return null;
  return response.json();
}

const supabaseRequireAuth = async (req, res, next) => {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error:{ code:'AUTH_REQUIRED', message:'Authentication required.' } });
  try {
    const user = await verifySupabaseAccessToken(token);
    if (!user?.id || !user?.email) return res.status(401).json({ error:{ code:'INVALID_TOKEN', message:'Session is invalid or expired.' } });
    const metadata = user.user_metadata || {};
    const customer = await repository.findCustomerBySupabaseUserId(user.id);
    const ensured = customer || await repository.createOrLinkCustomerFromSupabase({
      supabaseUserId: user.id,
      email: user.email,
      fullName: metadata.full_name || metadata.name || user.email.split('@')[0],
    });
    const identity = await repository.findCustomerById(ensured.id);
    if (!identity?.id || !['customer', 'vendor'].includes(identity.role)) {
      return res.status(403).json({ error:{ code:'ROLE_NOT_CONFIGURED', message:'Your RideOn account does not have a valid role.' } });
    }
    req.user = { id: identity.id, name: identity.fullName, email:identity.email || user.email, role:identity.role, supabaseUserId:user.id, vendor:identity.vendor };
    next();
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ error:{ code:error.code, message:error.message } });
    return res.status(401).json({ error:{ code:'INVALID_TOKEN', message:'Session is invalid or expired.' } });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error:{ code:'ROLE_FORBIDDEN', message:'You do not have access to this resource.' } });
  }
  next();
};

const requireCustomer = requireRole('customer');

const requireVendor = async (req, res, next) => {
  if (!req.user || req.user.role !== 'vendor') {
    return res.status(403).json({ error:{ code:'ROLE_FORBIDDEN', message:'Vendor access is required.' } });
  }
  try {
    const vendor = req.vendor || await repository.findVendorByCustomerId(req.user.id);
    if (!vendor) return res.status(403).json({ error:{ code:'VENDOR_NOT_CONFIGURED', message:'No vendor profile is configured for this account.' } });
    if (['suspended', 'rejected'].includes(vendor.status)) {
      return res.status(403).json({ error:{ code:'VENDOR_ACCESS_BLOCKED', message:'This vendor account is not currently allowed to access the partner portal.' } });
    }
    req.vendor = vendor;
    next();
  } catch {
    return res.status(403).json({ error:{ code:'VENDOR_NOT_CONFIGURED', message:'No vendor profile is configured for this account.' } });
  }
};

const requireAuth = supabaseRequireAuth;

app.get('/health', async (_req, res) => {
  const storage = await repository.health();
  const healthy = storage.mode === 'memory' || storage.reachable !== false;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'rideon-api',
    storage,
    paymentProvider: payments.name,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/vehicles', async (req, res) => {
  const type = req.query.type?.toString().toLowerCase();
  const city = req.query.city?.toString();
  const q = req.query.q?.toString();
  const vehicles = await repository.listVehicles({ type, city, q });
  const data = vehicles.map(mobileVehicle);
  res.json({ data, vehicles: data, meta: { count: data.length, currency: 'INR' } });
});

app.get('/api/v1/me', supabaseRequireAuth, async (req, res) => {
  const customer = await repository.findCustomerById(req.user.id);
  if (!customer) return res.status(404).json({ error:{ code:'USER_NOT_FOUND' } });
  const user = {
    id: customer.id,
    name: customer.fullName,
    email: customer.email || req.user.email,
    role: customer.role,
  };
  res.json({ user, customer });
});

app.get('/api/v1/vendor/me', supabaseRequireAuth, requireVendor, async (req, res) => {
  const customer = await repository.findCustomerById(req.user.id);
  if (!customer || customer.role !== 'vendor' || !req.vendor) {
    return res.status(403).json({ error:{ code:'VENDOR_NOT_CONFIGURED', message:'No vendor profile is configured for this account.' } });
  }
  res.json({
    user: { id:customer.id, name:customer.fullName, email:customer.email || req.user.email, role:'vendor' },
    vendor: req.vendor,
  });
});

app.get('/api/v1/vehicles/:id', async (req, res) => {
  const vehicle = await repository.getVehicle(req.params.id);
  if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found' } });
  const data = mobileVehicle(vehicle);
  res.json({ data, vehicle: data });
});


app.post('/api/v1/auth/request-otp', authRateLimit, async (req, res) => {
  const parsed = z.object({ email:z.string().trim().email().max(254), fullName:z.string().trim().min(2).max(100).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:{ code:'VALIDATION_ERROR', message:'Provide a valid email address.' } });
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return res.status(503).json({ error:{ code:'AUTH_NOT_CONFIGURED', message:'Supabase authentication is not configured.' } });
  const email = parsed.data.email.toLowerCase();
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/otp`, {
      method:'POST',
      headers:{ apikey:publishableKey, Authorization:`Bearer ${publishableKey}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ email, create_user:true, data: parsed.data.fullName ? { full_name: parsed.data.fullName } : undefined })
    });
    if (!response.ok) return res.status(response.status===429?429:502).json({ error:{ code:'OTP_REQUEST_FAILED', message:'Unable to send the RideOn verification email right now.' } });
    return res.json({ data:{ challenge:true, channel:'email', destination:email, expiresInSeconds:600 } });
  } catch {
    return res.status(502).json({ error:{ code:'OTP_REQUEST_FAILED', message:'Unable to send the RideOn verification email right now.' } });
  }
});

app.post('/api/v1/auth/verify-otp', authRateLimit, async (req, res) => {
  return res.status(410).json({ error:{ code:'OTP_FLOW_RETIRED', message:'RideOn now verifies email OTPs with Supabase Auth. Update the app to use the Supabase session.' } });
});

app.post('/api/v1/auth/register', authRateLimit, async (req, res) => {
  const parsed = z.object({
    fullName: z.string().trim().min(2).max(100),
    phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
    email: z.string().trim().email().max(254).optional(),
    password: z.string().min(8).max(128),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid registration details.' } });
  const passwordHash = await auth.hashPassword(parsed.data.password);
  const customer = await repository.createCustomer({ fullName: parsed.data.fullName, phone: parsed.data.phone, email: parsed.data.email, passwordHash });
  const accessToken = auth.sign({ sub: customer.id, role: 'customer' });
  res.status(201).json({ customer: { id: customer.id, fullName: customer.fullName, phone: customer.phone, email: customer.email }, accessToken, expiresIn: auth.accessTokenTtlSeconds });
});

app.post('/api/v1/auth/login', authRateLimit, async (req, res) => {
  const parsed = z.object({ phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/), password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid login details.' } });
  const customer = await repository.findCustomerByPhone(parsed.data.phone);
  if (!customer || !(await auth.verifyPassword(parsed.data.password, customer.passwordHash))) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Phone or password is incorrect.' } });
  const accessToken = auth.sign({ sub: customer.id, role: 'customer' });
  res.json({ customer: { id: customer.id, fullName: customer.fullName, phone: customer.phone, email: customer.email }, accessToken, expiresIn: auth.accessTokenTtlSeconds });
});

app.post('/api/v1/bookings/quote', requireCustomer, async (req, res) => {
  const normalized = normalizeBookingInput(req.body);
  const schema = z.object({ vehicleId: z.string(), startAt: z.string().datetime(), endAt: z.string().datetime(), delivery: z.boolean().default(true) })
    .refine((x) => new Date(x.endAt) > new Date(x.startAt), { message: 'endAt must be after startAt' });
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  const vehicle = await repository.getVehicle(parsed.data.vehicleId);
  if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND' } });
  const unavailable = await repository.isVehicleUnavailable(vehicle.id, parsed.data.startAt, parsed.data.endAt);
  if (unavailable) return res.status(409).json({ error: { code: 'VEHICLE_UNAVAILABLE', message: 'This vehicle already has a booking request for part of those dates.' } });
  const quote = { vehicleId: vehicle.id, ...pricing(vehicle, parsed.data.startAt, parsed.data.endAt, parsed.data.delivery) };
  res.json({ data: { ...quote, disclaimer: 'Estimate; final availability and fees must be confirmed.' }, quote });
});

app.post('/api/v1/bookings', requireCustomer, async (req, res) => {
  const parsed = bookingSchema.safeParse(normalizeBookingInput(req.body));
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the booking details.', details: parsed.error.flatten() } });
  const vehicle = await repository.getVehicle(parsed.data.vehicleId);
  if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND' } });
  const pricingData = pricing(vehicle, parsed.data.startAt, parsed.data.endAt, parsed.data.delivery);

  const idempotencyKey = req.get('Idempotency-Key')?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 128) return res.status(400).json({ error: { code: 'INVALID_IDEMPOTENCY_KEY' } });

  try {
    const booking = await repository.createBooking({
      customerId: req.user.id,
      vehicle,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      delivery: parsed.data.delivery,
      address: parsed.data.address,
      notes: parsed.data.notes,
      pricing: pricingData,
      idempotencyKey,
    });
    res.status(201).json({ data: publicBooking(booking), booking: publicBooking(booking) });
  } catch (error) {
    if (error.code === 'IDEMPOTENCY_REPLAY') return res.status(200).json({ data: publicBooking(error.booking), booking: publicBooking(error.booking) });
    if (error.code === 'VEHICLE_UNAVAILABLE') return res.status(409).json({ error: { code: 'VEHICLE_UNAVAILABLE', message: 'This vehicle is unavailable for part of those dates.' } });
    throw error;
  }
});

app.get('/api/v1/bookings', requireCustomer, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const data = await repository.listCustomerBookings({ customerId: req.user.id, limit, offset });
  res.json({ data: data.map(publicBooking), bookings: data.map(publicBooking), pagination: { limit, offset, count: data.length } });
});

app.get('/api/v1/bookings/:id', requireCustomer, async (req, res) => {
  const booking = await repository.getBooking(req.params.id, req.user.id);
  if (!booking) return res.status(404).json({ error: { code: 'BOOKING_NOT_FOUND' } });
  res.json({ data: publicBooking(booking), booking: publicBooking(booking) });
});

app.patch('/api/v1/bookings/:id/cancel', requireCustomer, async (req, res) => {
  const booking = await repository.getBooking(req.params.id);
  if (!booking) return res.status(404).json({ error: { code: 'BOOKING_NOT_FOUND' } });
  if (booking.customerId !== req.user.id) return res.status(404).json({ error: { code: 'BOOKING_NOT_FOUND' } });
  try {
    const updated = await repository.cancelBooking(req.params.id, req.user.id);
    if (!updated) return res.status(409).json({ error: { code: 'CANNOT_CANCEL', message: 'This booking can no longer be cancelled.' } });
    res.json({ data: publicBooking(updated), booking: publicBooking(updated) });
  } catch (error) {
    if (error.code === 'CANNOT_CANCEL') return res.status(409).json({ error: { code: error.code, message: error.message } });
    throw error;
  }
});

app.post('/api/v1/payments/webhook', async (req, res) => {
  const signature = req.get('X-Payment-Signature');
  const body = JSON.stringify(req.body);
  if (!payments.verifyWebhook(body, signature)) return res.status(401).json({ error: { code: 'INVALID_WEBHOOK_SIGNATURE' } });
  const event = payments.parseWebhook(req.body);
  if (!event) return res.status(400).json({ error: { code: 'INVALID_PAYMENT_EVENT' } });
  const result = await repository.applyPaymentEvent(event);
  res.json({ received: true, applied: result.applied, duplicate: result.duplicate });
});

app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use((err, _req, res, _next) => {
  console.error('[rideon-api]', err?.code || 'INTERNAL_ERROR');
  if (err.code === 'CUSTOMER_EXISTS') return res.status(409).json({ error: { code: err.code, message: 'A customer with those credentials already exists.' } });
  if (err.code === 'INVALID_CREDENTIALS') return res.status(401).json({ error: { code: err.code, message: 'Phone or password is incorrect.' } });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
});

const port = Number(process.env.PORT) || 4000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`RideOn API listening on :${port}`));
}
export { app, repository };
