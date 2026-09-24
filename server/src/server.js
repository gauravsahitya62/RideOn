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

const fleet = [];

const app = express();

// Deployment fingerprint: helps confirm the mobile app is talking to the current Render build.
const buildCommit = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'unknown';

// Lightweight request correlation and structured HTTP access logging.
// Never log request bodies, query strings, credentials, OTPs, or payment data.
app.use((req, res, next) => {
  const supplied = req.get('X-Request-Id') || '';
  const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID();
  const startedAt = process.hrtime.bigint();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(JSON.stringify({
      level:'info', event:'http_request', requestId, timestamp:new Date().toISOString(),
      method:req.method, route:req.path, status:res.statusCode,
      durationMs:Math.round(durationMs * 100) / 100,
      userId:req.user?.id || undefined,
    }));
  });
  next();
});
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet());
app.disable('x-powered-by');
const allowedOrigins = String(process.env.CLIENT_ORIGIN || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && allowedOrigins.includes('*')) throw new Error('CLIENT_ORIGIN must be explicit in production');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  credentials: false,
}));
app.use(express.json({ limit: '12mb', verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
app.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.GLOBAL_RATE_LIMIT || 120), standardHeaders: true, legacyHeaders: false }));
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


function validateBookingWindow(startAt,endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    const error = new Error('Pickup and return must form a valid booking window.');
    error.code = 'INVALID_BOOKING_WINDOW';
    throw error;
  }
  if (start.getTime() < Date.now()) {
    const error = new Error('Pickup cannot be in the past.');
    error.code = 'INVALID_BOOKING_WINDOW';
    throw error;
  }
  const days = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  if (days < 1 || days > 30) {
    const error = new Error('Booking duration must be between 1 and 30 days.');
    error.code = 'INVALID_BOOKING_WINDOW';
    throw error;
  }
  return { start, end, days };
}

function pricing(vehicle, startAt, endAt, delivery) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const durationMs = end.getTime() - start.getTime();
  const days = Math.ceil(durationMs / 86400000);
  if (!Number.isFinite(days) || days < 1 || days > 30) {
    const error = new Error('Booking duration must be between 1 and 30 days.');
    error.code = 'INVALID_BOOKING_WINDOW';
    throw error;
  }
  const rental = vehicle.pricePerDay * days;
  const deliveryFee = delivery ? 199 : 0;
  const platformFee = Math.round(rental * 0.05);
  const securityDeposit = Number(vehicle.securityDeposit || 0);
  const total = rental + deliveryFee + platformFee + securityDeposit;
  return { days, rental, deliveryFee, platformFee, securityDeposit, total, currency: 'INR', currencyUnit: 'rupees' };
}

const mobileVehicle = (v) => ({
  ...v,
  price: v.pricePerDay,
  detail: v.description || v.subtitle,
  emoji: v.type === 'car' ? '🚘' : '🏍️',
  color: v.type === 'car' ? '#E7E9EF' : '#F2E7DA',
  tag: 'Available',
  images: Array.isArray(v.imageUrls) ? v.imageUrls : [],
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
    paymentId: booking.paymentId,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt || booking.createdAt,
  };
}

const repository = createRepository({ databaseUrl: process.env.DATABASE_URL, fleet });
console.log('[RideOnServer][ROUTES_READY]', JSON.stringify({ routes:['GET /health','GET /api/v1/version','GET /api/v1/me','POST /api/v1/auth/request-otp','POST /api/v1/auth/verify-otp','POST /api/v1/auth/complete-registration'] }));
console.log('[RideOnServer][BOOT]', JSON.stringify({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  buildCommit,
  hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
  hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
  hasSupabaseKey: Boolean(process.env.SUPABASE_PUBLISHABLE_KEY)
}));
const paymentProvider = (process.env.PAYMENT_PROVIDER || (isProduction ? 'paytm' : 'mock')).toLowerCase();
const paytmMerchantId = process.env.PAYTM_MERCHANT_ID || '';
const paytmClientId = process.env.PAYTM_CLIENT_ID || '';
const paytmClientSecret = process.env.PAYTM_CLIENT_SECRET || '';
const paytmWebsite = process.env.PAYTM_WEBSITE || '';
const paytmCallbackUrl = process.env.PAYTM_CALLBACK_URL || '';
const paymentWebhookSecret = process.env.PAYTM_WEBHOOK_SECRET || '';
if (isProduction && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) throw new Error('JWT_SECRET must be configured with at least 32 characters in production');
if (isProduction && (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY)) throw new Error('Supabase Auth configuration is required in production');
if (isProduction && ['mock','unconfigured'].includes(paymentProvider)) throw new Error('PAYMENT_PROVIDER must be a real production payment provider.');
// Paytm credentials are intentionally optional at process startup. This keeps health/API deployment available
// while live payment operations fail closed with PAYTM_ONBOARDING_REQUIRED until merchant onboarding is complete.


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
  merchantId: paytmMerchantId,
  clientId: paytmClientId,
  clientSecret: paytmClientSecret,
  website: paytmWebsite,
  callbackUrl: paytmCallbackUrl,
  webhookSecret: paymentWebhookSecret,
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

  if (process.env.NODE_ENV === 'test' && (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY)) {
    return auth.middleware()(req, res, next);
  }

  try {
    const user = await verifySupabaseAccessToken(token);
    if (!user?.id || !user?.email) return res.status(401).json({ error:{ code:'INVALID_TOKEN', message:'Session is invalid or expired.' } });

    const metadata = user.user_metadata || {};
    let identity = await repository.findCustomerBySupabaseUserId(user.id);

    // Backward-compatible linking for existing RideOn identities that predate
    // the Supabase user link. Their stored RideOn role remains authoritative.
    if (!identity) {
      const existingByEmail = await repository.findCustomerByEmail(user.email);
      if (existingByEmail) {
        identity = await repository.createOrLinkCustomerFromSupabase({
          supabaseUserId:user.id,
          email:user.email,
          fullName:existingByEmail.fullName || metadata.full_name || metadata.name || user.email.split('@')[0],
          phone:existingByEmail.phone,
          role:existingByEmail.role || 'customer',
        });
      }
    }

    // Repair legacy Supabase accounts that existed before RideOn identity
    // linking was completed. A token-authenticated user with no RideOn row is
    // provisioned as a customer; vendor accounts must already have a vendor
    // profile created by the explicit vendor registration flow.
    if (!identity?.id) {
      identity = await repository.createOrLinkCustomerFromSupabase({
        supabaseUserId:user.id,
        email:user.email,
        fullName:metadata.full_name || metadata.name || user.email.split('@')[0],
        phone:metadata.phone || undefined,
        role:'customer',
      });
    }

    if (!identity?.id || !['customer','vendor'].includes(identity.role)) {
      return res.status(401).json({ error:{ code:'USER_ROLE_UNRESOLVED', message:'Your RideOn account type could not be determined.' } });
    }

    req.user = {
      id:identity.id,
      name:identity.fullName,
      role:identity.role,
      supabaseUserId:user.id,
      email:identity.email || user.email,
    };
    next();
  } catch (error) {
    if (error.code==='ACCOUNT_TYPE_CONFLICT') {
      return res.status(409).json({ error:{code:error.code,message:'A RideOn account already exists under a different account type.'} });
    }
    console.error(JSON.stringify({level:'error',event:'supabase_identity_error',requestId:req.requestId,code:error?.code||'INVALID_TOKEN'}));
    return res.status(401).json({ error:{ code:'INVALID_TOKEN', message:'Session is invalid or could not be mapped to a RideOn account.' } });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error:{ code:'FORBIDDEN', message:'You do not have access to this resource.' } });
  }
  next();
};

const requireCustomer = requireRole('customer');

const requireVendor = async (req, res, next) => {
  if (!req.user || req.user.role !== 'vendor') {
    return res.status(403).json({ error:{ code:'FORBIDDEN', message:'Vendor access is required.' } });
  }
  try {
    const vendor = await repository.findVendorByCustomerId(req.user.id);
    if (!vendor) return res.status(404).json({ error:{ code:'VENDOR_NOT_FOUND', message:'Vendor profile not found.' } });
    if (vendor.status === 'suspended') return res.status(403).json({ error:{ code:'FORBIDDEN', message:'Vendor account is suspended.' } });
    req.vendor = vendor;
    next();
  } catch {
    return res.status(404).json({ error:{ code:'VENDOR_NOT_FOUND', message:'Vendor profile not found.' } });
  }
};

app.get('/api/v1/version', (_req, res) => {
  res.json({ service:'rideon-api', buildCommit, nodeEnv:process.env.NODE_ENV || 'development', timestamp:new Date().toISOString() });
});

app.get('/api/v1/payments/capabilities', supabaseRequireAuth, requireCustomer, async (_req,res) => { res.json({payment:{method:'upi',provider:payments.name,configured:payments.configured,...(payments.capabilities||{})}}); });

app.get('/health', async (_req, res) => {
  const storage = await repository.health();
  const healthy = storage.mode === 'memory' || storage.reachable !== false;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'rideon-api',
    storage,
    paymentProvider: payments.name,
    buildCommit,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/locations', async (_req, res) => {
  try {
    const locations = await repository.listLocations();
    res.json({ data: locations, locations, meta: { count: locations.length } });
  } catch (error) {
    console.error(JSON.stringify({ level:'error', event:'locations_failed', requestId:_req.requestId, code:error?.code || 'LOCATIONS_FAILED', message:error?.message }));
    res.status(503).json({ error:{ code:'LOCATIONS_UNAVAILABLE', message:'Available RideOn locations are temporarily unavailable. Please retry.' } });
  }
});

app.get('/api/v1/vehicles', async (req, res) => {
  try {
    const type = req.query.type?.toString().toLowerCase();
    const city = req.query.city?.toString().trim();
    const q = req.query.q?.toString().trim();
    const vehicles = await repository.listVehicles({ type, city, q });
    const data = vehicles.map(mobileVehicle);
    res.json({ data, vehicles: data, meta: { count: data.length, currency: 'INR' } });
  } catch (error) {
    console.error(JSON.stringify({ level:'error', event:'vehicles_list_failed', requestId:req.requestId, code:error?.code || 'VEHICLES_LIST_FAILED', message:error?.message }));
    res.status(503).json({ error:{ code:'VEHICLES_UNAVAILABLE', message:'Vehicle inventory is temporarily unavailable. Please retry.' } });
  }
});

app.get('/api/v1/me', supabaseRequireAuth, async (req, res) => {
  const customer = await repository.findCustomerById(req.user.id);
  if (!customer) return res.status(404).json({ error:{ code:'USER_NOT_FOUND' } });
  const user={id:customer.id,name:customer.fullName,email:customer.email||req.user.email,role:req.user.role};
  res.json({user,customer});
});

app.get('/api/v1/vehicles/:id', async (req, res) => {
  const vehicle = await repository.getVehicle(req.params.id);
  if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found' } });
  const data = mobileVehicle(vehicle);
  res.json({ data, vehicle: data });
});

// Vendor profile and fleet management.
app.get('/api/v1/vendor/me', supabaseRequireAuth, requireVendor, async (req, res) => {
  res.json({ user: { id:req.user.id, name:req.user.name, email:req.user.email, role:'vendor' }, vendor:req.vendor });
});

app.patch('/api/v1/vendor/me', supabaseRequireAuth, requireVendor, async (req, res) => {
  const parsed=z.object({
    businessName:z.string().trim().min(2).max(160).optional(),
    contactName:z.string().trim().min(2).max(100).optional(),
    phone:z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional(),
    email:z.string().trim().email().max(254).optional(),
    address:z.string().trim().max(300).optional(),
    serviceCity:z.string().trim().min(2).max(100).optional(),
    serviceArea:z.record(z.any()).optional(),
  }).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Invalid vendor profile.',details:parsed.error.flatten()}});
  const vendor=await repository.updateVendor(req.user.id,parsed.data);
  if(!vendor) return res.status(404).json({error:{code:'VENDOR_NOT_FOUND',message:'Vendor profile not found.'}});
  res.json({vendor});
});

const vehicleInput=z.object({
  type:z.enum(['car','bike']),
  name:z.string().trim().min(2).max(160),
  make:z.string().trim().min(2).max(80).optional().default(''),
  model:z.string().trim().min(1).max(100).optional().default(''),
  year:z.number().int().min(1980).max(new Date().getFullYear()+1).nullable().optional(),
  city:z.string().trim().min(2).max(100),
  dailyRate:z.number().min(0),
  securityDeposit:z.number().min(0).optional().default(0),
  transmission:z.string().trim().max(30).optional().default(''),
  fuel:z.string().trim().max(30).optional().default(''),
  seats:z.number().int().min(1).max(16).nullable().optional(),
  registrationNumber:z.string().trim().max(30).optional().default(''),
  description:z.string().trim().max(2000).optional().default(''),
  imageUrls:z.array(z.string().url()).max(12).optional().default([]),
  deliveryAvailable:z.boolean().optional().default(true),
  active:z.boolean().optional().default(true),
});

app.post('/api/v1/vendor/vehicle-images', supabaseRequireAuth, requireVendor, async (req,res)=>{
  try{
    const supabaseUrl=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const storageKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    const bucket=String(process.env.SUPABASE_VEHICLE_IMAGE_BUCKET||'vehicle-images').trim();
    if(!supabaseUrl||!storageKey) return res.status(503).json({error:{code:'STORAGE_NOT_CONFIGURED',message:'Vehicle image storage is not configured on the API.'}});
    const base64=String(req.body?.base64||'').replace(/^data:image\/[^;]+;base64,/i,'').trim();
    const contentType=String(req.body?.contentType||'image/jpeg').toLowerCase();
    if(!base64) return res.status(400).json({error:{code:'IMAGE_REQUIRED',message:'Please select a vehicle image to upload.'}});
    if(!['image/jpeg','image/png','image/webp'].includes(contentType)) return res.status(400).json({error:{code:'IMAGE_TYPE_UNSUPPORTED',message:'Please upload a JPG, PNG, or WebP image.'}});
    const imageBuffer=Buffer.from(base64,'base64');
    if(!imageBuffer.length) return res.status(400).json({error:{code:'IMAGE_INVALID',message:'The selected image could not be read. Please choose it again.'}});
    if(imageBuffer.length>8*1024*1024) return res.status(413).json({error:{code:'IMAGE_TOO_LARGE',message:'Vehicle images must be 8 MB or smaller.'}});
    const extension=contentType==='image/png'?'png':contentType==='image/webp'?'webp':'jpg';
    const path=`vendors/${req.vendor.id}/${crypto.randomUUID()}.${extension}`;
    const response=await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`,{
      method:'POST',
      headers:{Authorization:`Bearer ${storageKey}`,apikey:storageKey,'Content-Type':contentType,'x-upsert':'false'},
      body:imageBuffer,
    });
    if(!response.ok){
      const details=await response.text().catch(()=> '');
      console.error(JSON.stringify({level:'error',event:'vehicle_image_upload_failed',requestId:req.requestId,status:response.status,details:details.slice(0,500)}));
      return res.status(502).json({error:{code:'IMAGE_UPLOAD_FAILED',message:'Vehicle image upload failed. Please try again.'}});
    }
    const publicUrl=`${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
    res.status(201).json({data:{url:publicUrl,path,bucket},url:publicUrl});
  }catch(error){
    console.error(JSON.stringify({level:'error',event:'vehicle_image_upload_error',requestId:req.requestId,message:error?.message}));
    res.status(500).json({error:{code:'IMAGE_UPLOAD_FAILED',message:'Vehicle image upload failed. Please try again.'}});
  }
});

app.get('/api/v1/vendor/vehicles', supabaseRequireAuth, requireVendor, async (req,res)=>{
  const activeParam=req.query.active?.toString();
  const active=activeParam===undefined?undefined:activeParam==='true';
  const vehicles=await repository.listVendorVehicles(req.vendor.id,{active});
  res.json({data:vehicles,vehicles,meta:{count:vehicles.length}});
});

app.post('/api/v1/vendor/vehicles', supabaseRequireAuth, requireVendor, async (req,res)=>{
  const parsed=vehicleInput.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:{code:'INVALID_VEHICLE',message:'Invalid vehicle details.',details:parsed.error.flatten()}});
  try{
    const vehicle=await repository.createVendorVehicle(req.vendor.id,parsed.data);
    res.status(201).json({data:vehicle,vehicle});
  }catch(error){
    if(error.code==='VEHICLE_EXISTS') return res.status(409).json({error:{code:error.code,message:'A vehicle with this registration number already exists.'}});
    throw error;
  }
});

app.get('/api/v1/vendor/vehicles/:id', supabaseRequireAuth, requireVendor, async (req,res)=>{
  const vehicle=await repository.getVendorVehicle(req.vendor.id,req.params.id);
  if(!vehicle) return res.status(404).json({error:{code:'VEHICLE_NOT_FOUND',message:'Vehicle not found.'}});
  res.json({data:vehicle,vehicle});
});

app.patch('/api/v1/vendor/vehicles/:id', supabaseRequireAuth, requireVendor, async (req,res)=>{
  const parsed=vehicleInput.partial().safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:{code:'INVALID_VEHICLE',message:'Invalid vehicle details.',details:parsed.error.flatten()}});
  try{
    const vehicle=await repository.updateVendorVehicle(req.vendor.id,req.params.id,parsed.data);
    if(!vehicle) return res.status(404).json({error:{code:'VEHICLE_NOT_FOUND',message:'Vehicle not found.'}});
    res.json({data:vehicle,vehicle});
  }catch(error){
    if(error.code==='VEHICLE_EXISTS') return res.status(409).json({error:{code:error.code,message:'A vehicle with this registration number already exists.'}});
    throw error;
  }
});

app.delete('/api/v1/vendor/vehicles/:id', supabaseRequireAuth, requireVendor, async (req,res)=>{
  const vehicle=await repository.deactivateVendorVehicle(req.vendor.id,req.params.id);
  if(!vehicle) return res.status(404).json({error:{code:'VEHICLE_NOT_FOUND',message:'Vehicle not found.'}});
  res.json({data:vehicle,vehicle});
});

app.get('/api/v1/vendor/bookings', supabaseRequireAuth, requireVendor, async (req,res)=>{
  const limit=Math.min(50,Math.max(1,Number(req.query.limit)||20));
  const offset=Math.max(0,Number(req.query.offset)||0);
  const data=await repository.listVendorBookings(req.vendor.id,{limit,offset});
  res.json({data:data.map(publicBooking),bookings:data.map(publicBooking),pagination:{limit,offset,count:data.length}});
});

app.get('/api/v1/vendor/bookings/:id', supabaseRequireAuth, requireVendor, async (req,res)=>{
  const booking=await repository.getVendorBooking(req.vendor.id,req.params.id);
  if(!booking) return res.status(404).json({error:{code:'BOOKING_NOT_FOUND',message:'Booking not found.'}});
  res.json({data:publicBooking(booking),booking:publicBooking(booking)});
});

app.patch('/api/v1/vendor/bookings/:id/status', supabaseRequireAuth, requireVendor, async (req,res)=>{
  const parsed=z.object({status:z.enum(['confirmed','rejected','cancelled','in_progress','completed']),note:z.string().trim().max(500).optional()}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:{code:'INVALID_BOOKING_STATUS',message:'Invalid booking status.',details:parsed.error.flatten()}});
  try{
    const booking=await repository.updateVendorBookingStatus(req.vendor.id,req.params.id,parsed.data.status,parsed.data.note);
    res.json({data:publicBooking(booking),booking:publicBooking(booking)});
  }catch(error){
    if(error.code==='BOOKING_NOT_FOUND') return res.status(404).json({error:{code:error.code,message:'Booking not found.'}});
    if(error.code==='INVALID_BOOKING_TRANSITION') return res.status(409).json({error:{code:error.code,message:'Booking cannot move to that status.'}});
    if(error.code==='INVALID_BOOKING_STATUS') return res.status(400).json({error:{code:error.code,message:'Invalid booking status.'}});
    throw error;
  }
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
    if (!response.ok) {
      const providerPayload = await response.text().catch(() => '');
      let providerError = {};
      try { providerError = providerPayload ? JSON.parse(providerPayload) : {}; } catch {}
      console.error('[rideon-auth] Supabase OTP request failed', {
        status: response.status,
        code: providerError?.error_code || providerError?.error,
        message: providerError?.msg || providerError?.message || providerError?.error_description,
      });
      return res.status(response.status === 429 ? 429 : 502).json({
        error:{
          code:'OTP_REQUEST_FAILED',
          message: providerError?.msg || providerError?.message || providerError?.error_description || 'Unable to send the RideOn verification email right now.',
          providerCode: providerError?.error_code || providerError?.error || undefined,
          providerStatus: response.status,
        }
      });
    }
    return res.json({ data:{ challenge:true, channel:'email', destination:email, expiresInSeconds:600 } });
  } catch {
    return res.status(502).json({ error:{ code:'OTP_REQUEST_FAILED', message:'Unable to send the RideOn verification email right now.' } });
  }
});

app.post('/api/v1/auth/complete-registration', authRateLimit, async (req,res) => {
  console.log('[RideOnAuth][COMPLETE_REGISTRATION_REQUEST]', JSON.stringify({
    requestId:req.requestId,
    method:req.method,
    path:req.path,
    hasAuthorization:Boolean(req.get('Authorization')),
    bodyKeys:Object.keys(req.body || {}),
    accountType:req.body?.accountType || null,
    fullNameLength:String(req.body?.fullName || '').length,
    hasPhone:Boolean(req.body?.phone),
    buildCommit
  }));
  const header=req.get('Authorization')||'';
  const token=header.startsWith('Bearer ')?header.slice(7).trim():'';
  if(!token) return res.status(401).json({error:{code:'AUTH_REQUIRED',message:'Authentication required.'}});
  const parsed=z.object({
    accountType:z.enum(['customer','vendor']),
    fullName:z.string().trim().min(2).max(100),
    phone:z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional(),
  }).superRefine((value,ctx)=>{
    if(value.accountType==='vendor' && !value.phone) ctx.addIssue({code:z.ZodIssueCode.custom,path:['phone'],message:'Vendor phone number is required.'});
  }).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Provide a valid account type and registration details.'}});
  try{
    console.log('[RideOnAuth][TOKEN_VERIFY_START]', JSON.stringify({requestId:req.requestId, buildCommit}));
    const supa=await verifySupabaseAccessToken(token);
    console.log('[RideOnAuth][TOKEN_VERIFY_RESULT]', JSON.stringify({requestId:req.requestId, valid:Boolean(supa?.id), hasEmail:Boolean(supa?.email)}));
    if(!supa?.id||!supa?.email) return res.status(401).json({error:{code:'INVALID_TOKEN',message:'Session is invalid or expired.'}});
    console.log('[RideOnAuth][IDENTITY_LINK_START]', JSON.stringify({requestId:req.requestId, accountType:parsed.data.accountType, email: supa.email}));
    const customer=await repository.createOrLinkCustomerFromSupabase({
      supabaseUserId:supa.id,email:supa.email,fullName:parsed.data.fullName,phone:parsed.data.phone,role:parsed.data.accountType,
    });
    console.log('[RideOnAuth][IDENTITY_LINK_SUCCESS]', JSON.stringify({requestId:req.requestId, customerId:customer.id, role:customer.role}));
    let vendor=null;
    if(parsed.data.accountType==='vendor'){
      console.log('[RideOnAuth][VENDOR_PROFILE_START]', JSON.stringify({requestId:req.requestId, customerId:customer.id}));
      vendor=await repository.ensureVendorForCustomer(customer.id,{
        businessName:parsed.data.fullName,contactName:parsed.data.fullName,
        phone:parsed.data.phone,email:supa.email,serviceCity:'Udaipur'
      });
      console.log('[RideOnAuth][VENDOR_PROFILE_RESULT]', JSON.stringify({requestId:req.requestId, created:Boolean(vendor)}));
      if(!vendor) return res.status(500).json({error:{code:'VENDOR_PROFILE_FAILED',message:'We could not create your vendor profile right now.'}});
    }
    return res.json({user:{id:customer.id,name:customer.fullName,email:customer.email,role:customer.role},customer,vendor});
  }catch(error){
    console.error('[RideOnAuth][COMPLETE_REGISTRATION_ERROR]', JSON.stringify({requestId:req.requestId, code:error?.code, message:error?.message, buildCommit}));
    if(error.code==='ACCOUNT_TYPE_CONFLICT') return res.status(409).json({error:{code:error.code,message:error.message}});
    console.error(JSON.stringify({level:'error',event:'registration_completion_failed',requestId:req.requestId,code:error?.code||'REGISTRATION_COMPLETION_FAILED'}));
    return res.status(500).json({error:{code:'REGISTRATION_COMPLETION_FAILED',message:'We could not complete your RideOn registration right now.'}});
  }
});

app.post('/api/v1/auth/verify-otp', authRateLimit, async (req, res) => {
  const parsed = z.object({ email:z.string().trim().email().max(254), token:z.string().trim().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:{ code:'VALIDATION_ERROR', message:'Provide the email address and 6-digit verification code.' } });
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return res.status(503).json({ error:{ code:'AUTH_NOT_CONFIGURED', message:'Supabase authentication is not configured.' } });
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
      method:'POST',
      headers:{ apikey:publishableKey, Authorization:`Bearer ${publishableKey}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ email:parsed.data.email.toLowerCase(), token:parsed.data.token, type:'email' })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.access_token) {
      return res.status(response.status===429?429:401).json({ error:{ code:'OTP_VERIFICATION_FAILED', message:payload?.msg || payload?.error_description || 'The verification code is invalid or expired.' } });
    }
    return res.json({ data:{ accessToken:payload.access_token, refreshToken:payload.refresh_token, expiresIn:payload.expires_in }, accessToken:payload.access_token });
  } catch (error) {
    console.error('[rideon-auth] OTP verification failed', { message:error?.message, code:error?.code });
    return res.status(502).json({ error:{ code:'OTP_VERIFICATION_FAILED', message:'Unable to verify the RideOn code right now.' } });
  }
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

app.get('/api/v1/vehicles/:id/availability', supabaseRequireAuth, requireCustomer, async (req, res) => {
  const schema = z.object({ startAt:z.string().datetime(), endAt:z.string().datetime() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error:{code:'INVALID_BOOKING_WINDOW',message:'Provide valid ISO startAt and endAt timestamps.',details:parsed.error.flatten()} });
  try {
    validateBookingWindow(parsed.data.startAt, parsed.data.endAt);
    const availability = await repository.checkVehicleAvailability(req.params.id, parsed.data.startAt, parsed.data.endAt);
    if (!availability.exists) return res.status(404).json({error:{code:'VEHICLE_NOT_FOUND',message:'Vehicle not found.'}});
    if (!availability.active) return res.status(409).json({error:{code:'VEHICLE_INACTIVE',message:'This vehicle is not currently available for booking.'}});
    res.json(availability);
  } catch(error) {
    if(error.code==='INVALID_BOOKING_WINDOW') return res.status(400).json({error:{code:error.code,message:error.message}});
    throw error;
  }
});

app.post('/api/v1/bookings/quote', supabaseRequireAuth, requireCustomer, async (req, res) => {
  const normalized = normalizeBookingInput(req.body);
  const schema = z.object({ vehicleId: z.string(), startAt: z.string().datetime(), endAt: z.string().datetime(), delivery: z.boolean().default(true) })
    .refine((x) => new Date(x.endAt) > new Date(x.startAt), { message: 'endAt must be after startAt' });
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_BOOKING_WINDOW', message:'Please check the booking window.', details: parsed.error.flatten() } });
  let vehicle;
  try { vehicle = await repository.getVehicle(parsed.data.vehicleId); } catch (error) { if(error.code==='INVALID_BOOKING_WINDOW') return res.status(400).json({error:{code:error.code,message:error.message}}); throw error; }
  if (!vehicle) return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND' } });
  try {
    const availability = await repository.checkVehicleAvailability(vehicle.id, parsed.data.startAt, parsed.data.endAt);
    if (!availability.available) return res.status(409).json({ error:{ code:'VEHICLE_UNAVAILABLE', message:'This vehicle is unavailable for the selected dates.' } });
  } catch (error) {
    if(error.code==='INVALID_BOOKING_WINDOW') return res.status(400).json({ error:{code:error.code,message:'The booking window is invalid.'} });
    throw error;
  }
  let quote;
  try { quote = { vehicleId: vehicle.id, ...pricing(vehicle, parsed.data.startAt, parsed.data.endAt, parsed.data.delivery) }; } catch(error) { return res.status(400).json({error:{code:error.code||'INVALID_BOOKING_WINDOW',message:error.message}}); }
  res.json({ data: { ...quote, disclaimer: 'Estimate; final availability and fees must be confirmed.' }, quote });
});

app.post('/api/v1/bookings', supabaseRequireAuth, requireCustomer, async (req, res) => {
  const parsed = bookingSchema.safeParse(normalizeBookingInput(req.body));
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the booking details.', details: parsed.error.flatten() } });
  try { validateBookingWindow(parsed.data.startAt, parsed.data.endAt); } catch(error) { return res.status(400).json({error:{code:error.code||'INVALID_BOOKING_WINDOW',message:error.message}}); }
  const vehicle = await repository.getVehicle(parsed.data.vehicleId);
  if (!vehicle) {
    const state = await repository.getVehicleState(parsed.data.vehicleId);
    if (!state.exists) return res.status(404).json({error:{code:'VEHICLE_NOT_FOUND',message:'Vehicle not found.'}});
    if (!state.active) return res.status(409).json({error:{code:'VEHICLE_INACTIVE',message:'This vehicle is not currently available for booking.'}});
    return res.status(404).json({error:{code:'VEHICLE_NOT_FOUND',message:'Vehicle not found.'}});
  }
  let pricingData;
  try { pricingData = pricing(vehicle, parsed.data.startAt, parsed.data.endAt, parsed.data.delivery); } catch(error) { return res.status(400).json({error:{code:error.code||'INVALID_BOOKING_WINDOW',message:error.message}}); }

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
    if (error.code === 'VEHICLE_INACTIVE') return res.status(409).json({ error:{code:'VEHICLE_INACTIVE',message:'This vehicle is not currently available for booking.'} });
    if (error.code === 'VEHICLE_NOT_FOUND') return res.status(404).json({ error:{code:'VEHICLE_NOT_FOUND',message:'Vehicle not found.'} });
    throw error;
  }
});

app.get('/api/v1/bookings', supabaseRequireAuth, requireCustomer, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const data = await repository.listCustomerBookings({ customerId: req.user.id, limit, offset });
    const mapped = data.map(publicBooking);
    res.json({ data: mapped, bookings: mapped, pagination: { limit, offset, count: data.length } });
  } catch (error) {
    console.error(JSON.stringify({ level:'error', event:'customer_bookings_failed', requestId:req.requestId, code:error?.code || 'BOOKINGS_LIST_FAILED', message:error?.message }));
    res.status(503).json({ error:{ code:'BOOKINGS_UNAVAILABLE', message:'Your bookings are temporarily unavailable. Please retry.' } });
  }
});

app.get('/api/v1/bookings/:id', supabaseRequireAuth, requireCustomer, async (req, res) => {
  const booking = await repository.getBooking(req.params.id, req.user.id);
  if (!booking) return res.status(404).json({ error: { code: 'BOOKING_NOT_FOUND' } });
  res.json({ data: publicBooking(booking), booking: publicBooking(booking) });
});

app.patch('/api/v1/bookings/:id/cancel', supabaseRequireAuth, requireCustomer, async (req, res) => {
  const booking = await repository.getBooking(req.params.id);
  if (!booking) return res.status(404).json({ error: { code: 'BOOKING_NOT_FOUND' } });
  if (booking.customerId !== req.user.id) return res.status(404).json({ error: { code: 'BOOKING_NOT_FOUND' } });
  if (booking.paymentStatus === 'paid') return res.status(409).json({ error: { code: 'REFUND_POLICY_REQUIRED', message: 'This paid booking requires an approved refund policy before cancellation.' } });
  if (booking.paymentStatus === 'refunded') return res.status(409).json({ error: { code: 'INVALID_PAYMENT_STATE', message: 'A refunded booking cannot be cancelled again.' } });
  try {
    const updated = await repository.cancelBooking(req.params.id, req.user.id);
    if (!updated) return res.status(409).json({ error: { code: 'CANNOT_CANCEL', message: 'This booking can no longer be cancelled.' } });
    res.json({ data: publicBooking(updated), booking: publicBooking(updated) });
  } catch (error) {
    if (error.code === 'CANNOT_CANCEL') return res.status(409).json({ error: { code: error.code, message: error.message } });
    throw error;
  }
});

app.post('/api/v1/payments/create-order', supabaseRequireAuth, requireCustomer, async (req,res) => {
  const parsed=z.object({ bookingId:z.string().uuid(), idempotencyKey:z.string().trim().min(8).max(128).optional() }).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'bookingId is required.',details:parsed.error.flatten()}});
  const booking=await repository.getBooking(parsed.data.bookingId, req.user.id);
  if(!booking) return res.status(404).json({error:{code:'BOOKING_NOT_FOUND',message:'Booking not found.'}});
  if(['cancelled','rejected','completed'].includes(booking.status)) return res.status(409).json({error:{code:'BOOKING_NOT_PAYABLE',message:'This booking cannot be paid.'}});
  if(booking.paymentStatus==='paid') return res.status(409).json({error:{code:'PAYMENT_ALREADY_PAID',message:'This booking is already paid.'}});
  try {
    return await repository.withPaymentLock(booking.id, async () => {
      const amountPaise=Math.round(Number(booking.pricing.total)*100);
      const existing=await repository.findPaymentByBooking(booking.id);
      if(existing && ['unpaid','pending'].includes(existing.status)) {
        return res.json({payment:{
          id:existing.id, bookingId:existing.bookingId, provider:existing.provider || paymentProvider,
          amount:existing.amountPaise, amountPaise:existing.amountPaise,
          currency:'INR', status:existing.status,
          paymentReference:existing.providerOrderId || existing.providerReference,
        }});
      }
      const paymentReference = `rideon_${booking.id}`;
      const paymentRequest=await payments.createCustomerPayment({ orderId:paymentReference, amountPaise });
      const result=await repository.createOrGetPaymentOrder({
        bookingId:booking.id,
        customerId:req.user.id,
        provider:paymentProvider,
        amountPaise,
        currency:'INR',
        idempotencyKey:parsed.data.idempotencyKey,
        providerOrder:{id:paymentRequest.providerOrderId,amountPaise:paymentRequest.amountPaise,currency:'INR'},
      });
      return res.status(201).json({payment:{
        id:result.payment.id,
        bookingId:result.payment.bookingId,
        provider:paymentProvider,
        amount:result.payment.amountPaise,
        amountPaise:result.payment.amountPaise,
        currency:'INR',
        status:result.payment.status,
        paymentReference:result.payment.providerOrderId,
        paymentUrl:paymentRequest.paymentUrl,
      }});
    });
  } catch(error) {
    if(error.code==='PAYMENT_NOT_CONFIGURED') return res.status(503).json({error:{code:'PAYMENT_NOT_CONFIGURED',message:'Paytm payments are not configured on the RideOn server.'}});
    if(error.code==='PAYMENT_CREATION_FAILED') return res.status(502).json({error:{code:error.code,message:error.message}});
    if(error.code==='UPI_PROVIDER_INTEGRATION_REQUIRED') return res.status(503).json({error:{code:error.code,message:'UPI checkout is not enabled for the configured payment provider yet.'}});
    if(error.code==='PAYTM_ONBOARDING_REQUIRED'||error.code==='UPI_PROVIDER_INTEGRATION_REQUIRED') return res.status(503).json({error:{code:error.code,message:'UPI checkout is not enabled for the configured payment provider yet. No payment has been marked successful.'}});
    if(error.code==='PAYMENT_ALREADY_PAID') return res.status(409).json({error:{code:error.code,message:'This booking is already paid.'}});
    throw error;
  }
});

app.post('/api/v1/payments/:id/verify', supabaseRequireAuth, requireCustomer, async (req,res) => {
  const parsed=z.object({ bookingId:z.string().uuid(), transactionReference:z.string().trim().min(4).max(128).optional() }).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Provide a valid bookingId and transaction reference.'}});
  let payment=await repository.findPaymentById(req.params.id, req.user.id);
  if(!payment || String(payment.bookingId)!==String(parsed.data.bookingId)) return res.status(404).json({error:{code:'PAYMENT_NOT_FOUND',message:'Payment not found.'}});
  if(String(payment.status).toLowerCase()==='paid') return res.json({payment,verification:'already_verified',bookingPaymentStatus:'paid'});
  if(parsed.data.transactionReference){
    try{payment=await repository.submitPaymentReference({paymentId:req.params.id,bookingId:parsed.data.bookingId,customerId:req.user.id,providerReference:parsed.data.transactionReference});}
    catch(error){
      if(error.code==='PAYMENT_NOT_FOUND') return res.status(404).json({error:{code:error.code,message:'Payment not found.'}});
      if(error.code==='PAYMENT_VERIFICATION_FAILED') return res.status(409).json({error:{code:error.code,message:'The transaction reference could not be recorded.'}});
      throw error;
    }
  }
  try {
    const verified=await payments.verifyPayment({providerOrderId:payment.providerOrderId,providerPaymentId:payment.providerPaymentId,providerReference:payment.providerReference,amountPaise:payment.amountPaise});
    if(!verified?.verified) return res.status(409).json({error:{code:'PAYMENT_VERIFICATION_PENDING',message:'The provider has not authoritatively confirmed this payment yet.'}});
    const providerReference=String(verified.providerReference||payment.providerReference||payment.providerPaymentId||'').trim();
    if(!providerReference) return res.status(409).json({error:{code:'PAYMENT_VERIFICATION_PENDING',message:'The payment is awaiting an authoritative provider reference.'}});
    const applied=await repository.applyPaymentEvent({eventId:`verify:${payment.id}:${providerReference}`,bookingId:String(payment.bookingId),paymentId:String(payment.id),providerReference,providerOrderId:String(payment.providerOrderId),amountPaise:Number(payment.amountPaise),currency:'INR',status:'paid'});
    if(applied.invalid) return res.status(409).json({error:{code:'PAYMENT_NOT_VERIFIED',message:'The provider response did not match the booking amount or payment order.'}});
    const latestBooking=await repository.getBooking(payment.bookingId,req.user.id);
    const latestPayment=await repository.findPaymentById(payment.id,req.user.id);
    return res.json({payment:latestPayment,verification:'verified',bookingPaymentStatus:latestBooking?.paymentStatus||'pending'});
  }catch(error){
    if(error.code==='PAYTM_ONBOARDING_REQUIRED'||error.code==='UPI_PROVIDER_INTEGRATION_REQUIRED') return res.status(503).json({error:{code:error.code,message:'UPI payment verification is not enabled for the configured provider yet. No payment has been marked successful.'}});
    throw error;
  }
});

app.post('/api/v1/vendor/bookings/:bookingId/refund', supabaseRequireAuth, requireVendor, async (req,res) => {
  const scopedBooking=await repository.getVendorBooking(req.vendor.id,req.params.bookingId);
  if(!scopedBooking) return res.status(404).json({error:{code:'BOOKING_NOT_FOUND',message:'Booking not found.'}});
  const payment=await repository.findPaymentByBooking(req.params.bookingId);
  if(!payment || payment.status!=='paid') return res.status(409).json({error:{code:'INVALID_PAYMENT_STATE',message:'Only a paid booking can enter the refund flow.'}});
  return res.status(409).json({error:{code:'REFUND_PROVIDER_REQUIRED',message:'Refund requires the configured provider integration and authorized workflow.'}});
});

app.get('/api/v1/payments/:id', supabaseRequireAuth, requireCustomer, async (req,res) => {
  const payment=await repository.findPaymentById(req.params.id, req.user.id);
  if(!payment) return res.status(404).json({error:{code:'PAYMENT_NOT_FOUND',message:'Payment not found.'}});
  const booking=await repository.getBooking(payment.bookingId, req.user.id);
  if(!booking) return res.status(404).json({error:{code:'PAYMENT_NOT_FOUND',message:'Payment not found.'}});
  res.json({payment});
});

app.post('/api/v1/payments/webhook', async (req, res) => {
  const signature = req.get('X-Paytm-Signature') || req.get('X-Payment-Signature');
  const body = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  if (!payments.verifyWebhook(body, signature)) return res.status(401).json({ error:{code:'INVALID_WEBHOOK_SIGNATURE'} });
  const event = payments.parseWebhook(req.body, { eventId: req.get('X-Paytm-Event-Id') || undefined });
  if (!event) return res.status(400).json({ error:{code:'INVALID_PAYMENT_EVENT'} });
  if (!event.bookingId && event.providerOrderId) {
    const payment = await repository.findPaymentByProviderOrder(event.providerOrderId);
    if (payment) event.bookingId = payment.bookingId;
  }
  if (!event.bookingId) return res.status(400).json({ error:{code:'INVALID_PAYMENT_EVENT'} });
  const result = await repository.applyPaymentEvent(event);
  if (result.invalid) return res.status(400).json({ error:{code:'INVALID_PAYMENT_EVENT',message:'Payment event does not match the booking payment.'} });
  res.json({received:true,applied:result.applied,duplicate:result.duplicate});
});

app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId:req.requestId } }));
app.use((err, req, res, _next) => {
  console.error(JSON.stringify({
    level:'error', event:'api_error', requestId:req.requestId, timestamp:new Date().toISOString(),
    method:req.method, route:req.path, status:500, code:err?.code || 'INTERNAL_ERROR', userId:req.user?.id || undefined,
  }));
  if (err.code === 'CUSTOMER_EXISTS') return res.status(409).json({ error: { code: err.code, message: 'A customer with those credentials already exists.' } });
  if (err.code === 'INVALID_CREDENTIALS') return res.status(401).json({ error: { code: err.code, message: 'Phone or password is incorrect.' } });
  if (err.code === 'PAYMENT_PROVIDER_UNSUPPORTED') return res.status(500).json({ error: { code: err.code, message: 'Unsupported payment provider configuration.' } });
  if (err.code === 'PAYTM_ONBOARDING_REQUIRED') return res.status(503).json({ error: { code: err.code, message: 'Paytm provider onboarding/integration is not enabled.' } });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
});

const port = Number(process.env.PORT) || 4000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`RideOn API listening on :${port}`));
}
export { app, repository };
