import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '32kb' }));
const fleet = [
  { id: 'creta-01', type: 'car', name: 'Hyundai Creta', subtitle: 'Automatic · 5 seats · Petrol', pricePerDay: 2499, city: 'Jaipur', seats: 5, transmission: 'Automatic', fuel: 'Petrol', active: true },
  { id: 'baleno-01', type: 'car', name: 'Maruti Baleno', subtitle: 'Manual · 5 seats · Petrol', pricePerDay: 1499, city: 'Jaipur', seats: 5, transmission: 'Manual', fuel: 'Petrol', active: true },
  { id: 'classic-01', type: 'bike', name: 'Royal Enfield Classic 350', subtitle: '349 cc · 2 helmets included', pricePerDay: 999, city: 'Jaipur', active: true },
  { id: 'activa-01', type: 'bike', name: 'Honda Activa 6G', subtitle: 'Automatic · 2 seats · Petrol', pricePerDay: 499, city: 'Jaipur', active: true },
];
const bookings = new Map();
const mobileVehicle = (v) => ({ ...v, price: v.pricePerDay, detail: v.subtitle, emoji: v.type === 'car' ? '🚘' : '🏍️', color: v.type === 'car' ? '#E7E9EF' : '#F2E7DA', tag: 'Available' });
const bookingSchema = z.object({ customerName: z.string().trim().min(2).max(100).optional().default('RideOn guest'), phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional(), vehicleId: z.string().min(1), startAt: z.string().datetime(), endAt: z.string().datetime(), delivery: z.boolean().default(true), address: z.string().trim().min(8).max(300), notes: z.string().max(500).optional() }).refine((x) => new Date(x.endAt) > new Date(x.startAt), { message: 'endAt must be after startAt', path: ['endAt'] });
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
  const rental = vehicle.pricePerDay * days; const deliveryFee = delivery ? 199 : 0; const platformFee = Math.round(rental * 0.05);
  return { days, rental, deliveryFee, platformFee, total: rental + deliveryFee + platformFee, currency: 'INR' };
}
function overlaps(vehicleId, startAt, endAt) {
  const start = new Date(startAt).getTime(); const end = new Date(endAt).getTime();
  return [...bookings.values()].some((b) => b.vehicleId === vehicleId && ['requested', 'confirmed'].includes(b.status) && start < new Date(b.endAt).getTime() && end > new Date(b.startAt).getTime());
}
function serializeBooking(b) { return { ...b, bookingId: b.id, vehicleName: b.vehicle.name, totalPrice: b.pricing.total, total: b.pricing.total }; }
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'rideon-api', timestamp: new Date().toISOString() }));
app.get('/api/v1/vehicles', (req, res) => {
  const type = req.query.type?.toString().toLowerCase(); const city = req.query.city?.toString().toLowerCase(); const q = req.query.q?.toString().toLowerCase();
  const data = fleet.filter((v) => v.active && (!type || type === 'all' || v.type === type) && (!city || v.city.toLowerCase() === city) && (!q || `${v.name} ${v.subtitle}`.toLowerCase().includes(q))).map(mobileVehicle);
  res.json({ data, vehicles: data, meta: { count: data.length, currency: 'INR' } });
});
app.get('/api/v1/vehicles/:id', (req, res) => {
  const vehicle = fleet.find((v) => v.id === req.params.id && v.active);
  if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found' } });
  const data = mobileVehicle(vehicle); res.json({ data, vehicle: data });
});
app.post('/api/v1/bookings/quote', (req, res) => {
  const normalized = normalizeBookingInput(req.body);
  const schema = z.object({ vehicleId: z.string(), startAt: z.string().datetime(), endAt: z.string().datetime(), delivery: z.boolean().default(true) }).refine((x) => new Date(x.endAt) > new Date(x.startAt), { message: 'endAt must be after startAt' });
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
  const vehicle = fleet.find((v) => v.id === parsed.data.vehicleId && v.active);
  if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND' } });
  if (overlaps(vehicle.id, parsed.data.startAt, parsed.data.endAt)) return res.status(409).json({ error: { code: 'VEHICLE_UNAVAILABLE', message: 'This vehicle already has a booking request for part of those dates.' } });
  const quote = { vehicleId: vehicle.id, ...pricing(vehicle, parsed.data.startAt, parsed.data.endAt, parsed.data.delivery) };
  res.json({ data: { ...quote, disclaimer: 'Demo estimate; availability and final fees must be confirmed.' }, quote });
});
app.post('/api/v1/bookings', (req, res) => {
  const parsed = bookingSchema.safeParse(normalizeBookingInput(req.body));
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the booking details.', details: parsed.error.flatten() } });
  const vehicle = fleet.find((v) => v.id === parsed.data.vehicleId && v.active);
  if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND' } });
  if (overlaps(vehicle.id, parsed.data.startAt, parsed.data.endAt)) return res.status(409).json({ error: { code: 'VEHICLE_UNAVAILABLE', message: 'This vehicle already has a booking request for part of those dates.' } });
  const booking = { id: randomUUID(), ...parsed.data, vehicle: { id: vehicle.id, name: vehicle.name, type: vehicle.type }, pricing: pricing(vehicle, parsed.data.startAt, parsed.data.endAt, parsed.data.delivery), status: 'requested', paymentStatus: 'unpaid', createdAt: new Date().toISOString() };
  bookings.set(booking.id, booking); const data = serializeBooking(booking); res.status(201).json({ data, booking: data });
});
app.get('/api/v1/bookings/:id', (req, res) => { const b = bookings.get(req.params.id); if (!b) return res.status(404).json({ error: { code: 'BOOKING_NOT_FOUND' } }); const data = serializeBooking(b); res.json({ data, booking: data }); });
app.patch('/api/v1/bookings/:id/cancel', (req, res) => {
  const b = bookings.get(req.params.id); if (!b) return res.status(404).json({ error: { code: 'BOOKING_NOT_FOUND' } });
  if (!['requested', 'confirmed'].includes(b.status)) return res.status(409).json({ error: { code: 'CANNOT_CANCEL', message: 'This booking can no longer be cancelled through this endpoint' } });
  b.status = 'cancelled'; b.updatedAt = new Date().toISOString(); const data = serializeBooking(b); res.json({ data, booking: data });
});
app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } }); });
const port = Number(process.env.PORT) || 4000;
if (process.env.NODE_ENV !== 'test') app.listen(port, () => console.log(`RideOn API listening on :${port}`));
export { app };
