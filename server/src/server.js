import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { createRepository } from './repository.js';
import { createAuth } from './auth.js';
import { createPaymentService } from './payments.js';

const fleet = [
  { id: 'creta-01', type: 'car', name: 'Hyundai Creta', subtitle: 'Automatic · 5 seats · Petrol', pricePerDay: 2499, city: 'Jaipur', seats: 5, transmission: 'Automatic', fuel: 'Petrol', active: true },
  { id: 'baleno-01', type: 'car', name: 'Maruti Baleno', subtitle: 'Manual · 5 seats · Petrol', pricePerDay: 1499, city: 'Jaipur', seats: 5, transmission: 'Manual', fuel: 'Petrol', active: true },
  { id: 'classic-01', type: 'bike', name: 'Royal Enfield Classic 350', subtitle: '349 cc · 2 helmets included', pricePerDay: 999, city: 'Jaipur', active: true },
  { id: 'activa-01', type: 'bike', name: 'Honda Activa 6G', subtitle: 'Automatic · 2 seats · Petrol', pricePerDay: 499, city: 'Jaipur', active: true },
];

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
const allowedOrigin = process.env.CLIENT_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin === '*' ? true : allowedOrigin }));
app.use(express.json({ limit: '32kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

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
  return { days, rental, deliveryFee, platformFee, total: rental + deliveryFee + platformFee, currency: 'INR' };
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
    customerId: booking.customerId,
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
    paymentProviderReference: booking.paymentProviderReference || null,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt || booking.createdAt,
  };
}

const repository = createRepository({ databaseUrl: process.env.DATABASE_URL, fleet });
const auth = createAuth({
  jwtSecret: process.env.JWT_SECRET,
  accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 3600),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
});
const payments = createPaymentService({
  provider: process.env.PAYMENT_PROVIDER || 'unconfigured',
  webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET,
});

const requireAuth = auth.middleware();

app.get('/health', async (_req, res) => {
  const storage = await repository.health();
  res.json({
    status: 'ok',
    service: 'rideon-api',
    storage,
    paymentProvider: payments.name,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/vehicles', (req, res) => {
  const type = req.query.type?.toString().toLowerCase();
  const city = req.query.city?.toString().toLowerCase();
  const q = req.query.q?.toString().toLowerCase();
  const data = fleet
    .filter((v) => v.active && (!type || type === 'all' || v.type === type) && (!city || v.city.toLowerCase() === city) && (!q || `${v.name} ${v.subtitle}`.toLowerCase().includes(q)))
    .map(mobileVehicle);
  res.json({ data, vehicles: data, meta: { count: data.length, currency: 'INR' } });
});

app.get('/api/v1/vehicles/:id', (req, res) => {
  const vehicle = fleet.find((v) => v.id === req.params.id && v.active);
  if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found' } });
  const data = mobileVehicle(vehicle);
  res.json({ data, vehicle: data });
});

app.post('/api/v1/auth/register', async (req, res) => {
  const parsed = z.object({
    fullName: z.string().trim().min(2).max(100),
    phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
    email: z.string().trim().email().max(254).optional(),
    password: z.string().min(8).max(128),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid registration details.' } });
  const passwordHash = await auth.hashPassword(parsed.data.password);
  const customer = await repository.createCustomer({ ...parsed.data, passwordHash });
  const accessToken = auth.sign({ sub: customer.id, role: 'customer' });
  res.status(201).json({ customer: { id: customer.id, fullName: customer.fullName, phone: customer.phone, email: customer.email }, accessToken, expiresIn: auth.accessTokenTtlSeconds });
});

app.post('/api/v1/auth/login', async (req, res) => {
  const parsed = z.object({ phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/), password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid login details.' } });
  const customer = await repository.findCustomerByPhone(parsed.data.phone);
  if (!customer || !(await auth.verifyPassword(parsed.data.password, customer.passwordHash))) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Phone or password is incorrect.' } });
  const accessToken = auth.sign({ sub: customer.id, role: 'customer' });
  res.json({ customer: { id: customer.id, fullName: customer.fullName, phone: customer.phone, email: customer.email }, accessToken, expiresIn: auth.accessTokenTtlSeconds });
});

app.post('/api/v1/bookings/quote', requireAuth, async (req, res) => {
  const normalized = normalizeBookingInput(req.body);
  const schema = z.object({ vehicleId: z.string(), startAt: z.string().datetime(), endAt: z.string().datetime(), delivery: z.boolean().default(true) })
    .refine((x) => new Date(x.endAt) > new Date(x.startAt), { message: 'endAt must be after startAt' });
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  const vehicle = fleet.find((v) => v.id === parsed.data.vehicleId && v.active);
  if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND' } });
  const unavailable = await repository.isVehicleUnavailable(vehicle.id, parsed.data.startAt, parsed.data.endAt);
  if (unavailable) return res.status(409).json({ error: { code: 'VEHICLE_UNAVAILABLE', message: 'This vehicle already has a booking request for part of those dates.' } });
  const quote = { vehicleId: vehicle.id, ...pricing(vehicle, parsed.data.startAt, parsed.data.endAt, parsed.data.delivery) };
  res.json({ data: { ...quote, disclaimer: 'Estimate; final availability and fees must be confirmed.' }, quote });
});

app.post('/api/v1/bookings', requireAuth, async (req, res) => {
  const parsed = bookingSchema.safeParse(normalizeBookingInput(req.body));
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the booking details.', details: parsed.error.flatten() } });
  const vehicle = fleet.find((v) => v.id === parsed.data.vehicleId && v.active);
  if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND' } });

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
      pricing: pricing(vehicle, parsed.data.startAt, parsed.data.endAt, parsed.data.delivery),
      idempotencyKey,
    });
    res.status(201).json({ data: publicBooking(booking), booking: publicBooking(booking) });
  } catch (error) {
    if (error.code === 'IDEMPOTENCY_REPLAY') return res.status(200).json({ data: publicBooking(error.booking), booking: publicBooking(error.booking) });
    if (error.code === 'VEHICLE_UNAVAILABLE') return res.status(409).json({ error: { code: 'VEHICLE_UNAVAILABLE', message: 'This vehicle is unavailable for part of those dates.' } });
    throw error;
  }
});

app.get('/api/v1/bookings', requireAuth, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const data = await repository.listCustomerBookings({ customerId: req.user.id, limit, offset });
  res.json({ data: data.map(publicBooking), bookings: data.map(publicBooking), pagination: { limit, offset, count: data.length } });
});

app.get('/api/v1/bookings/:id', requireAuth, async (req, res) => {
  const booking = await repository.getBooking(req.params.id);
  if (!booking) return res.status(404).json({ error: { code: 'BOOKING_NOT_FOUND' } });
  if (booking.customerId !== req.user.id) return res.status(404).json({ error: { code: 'BOOKING_NOT_FOUND' } });
  res.json({ data: publicBooking(booking), booking: publicBooking(booking) });
});

app.patch('/api/v1/bookings/:id/cancel', requireAuth, async (req, res) => {
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
export { app };
