import 'dotenv/config';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { createRepository } from './repository.js';
import { createAuth } from './auth.js';
import { createPaymentService } from './payments.js';
import { getDrivingRoute } from './routing.js';
import { geocodeAddress } from './geocoding.js';
import { createTrackingRealtimeServer } from './trackingRealtime.js';

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
// Render terminates TLS and forwards requests through its proxy. Trust exactly one proxy hop in production so\n// express-rate-limit can safely resolve the client address from X-Forwarded-For.\napp.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : (process.env.TRUST_PROXY === 'true' ? 1 : false));
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
const reviewRateLimit = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' });
const supportRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' });
const paymentRateLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

const bookingSchema = z.object({
  customerName: z.string().trim().min(2).max(100).optional().default('RideOn guest'),
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional(),
  vehicleId: z.string().trim().min(1).max(64),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  delivery: z.boolean().default(true),
  address: z.string().trim().min(8).max(300),
  notes: z.string().max(500).optional(),
  deliveryLatitude: z.union([z.number(), z.string()]).nullable().optional(),
  deliveryLongitude: z.union([z.number(), z.string()]).nullable().optional(),
  deliveryAddressSource: z.enum(['manual','geocoded','saved']).optional(),
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

function publicBooking(booking, { includeDeliveryLocation = false } = {}) {
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
    cancellationFee: booking.cancellationFee || 0,
    refundAmount: booking.refundAmount || 0,
    cancelledAt: booking.cancelledAt,
    cancellationReason: booking.cancellationReason,
    securityDepositStatus: booking.securityDepositStatus,
    securityDepositRefundable: booking.securityDepositRefundable || 0,
    securityDepositDeduction: booking.securityDepositDeduction || 0,
    securityDepositReason: booking.securityDepositReason,
    securityDepositEvidence: booking.securityDepositEvidence,
    securityDepositRefundReference: booking.securityDepositRefundReference,
    securityDepositInspectedAt: booking.securityDepositInspectedAt,
    securityDepositInspectedBy: booking.securityDepositInspectedBy,
    rejectionReason: booking.rejectionReason,
    routeDistanceMeters: booking.routeDistanceMeters,
    routeDurationSeconds: booking.routeDurationSeconds,
    routeProvider: booking.routeProvider,
    deliveryStatus: booking.deliveryStatus || 'scheduled',
    deliveryStartedAt: booking.deliveryStartedAt,
    deliveredAt: booking.deliveredAt,
    ...(includeDeliveryLocation && booking.deliveryStatus === 'in_delivery' && booking.deliveryLatitude != null && booking.deliveryLongitude != null ? {
      deliveryLatitude: booking.deliveryLatitude,
      deliveryLongitude: booking.deliveryLongitude,
    } : {}),
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
const paymentProvider = (process.env.PAYMENT_PROVIDER || (isProduction ? 'unconfigured' : 'mock')).toLowerCase();
const paytmMerchantId = process.env.PAYTM_MERCHANT_ID || '';
const paytmClientId = process.env.PAYTM_CLIENT_ID || '';
const paytmClientSecret = process.env.PAYTM_CLIENT_SECRET || '';
const paytmWebsite = process.env.PAYTM_WEBSITE || '';
const paytmCallbackUrl = process.env.PAYTM_CALLBACK_URL || '';
const paymentWebhookSecret = process.env.PAYTM_WEBHOOK_SECRET || '';
if (isProduction && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) throw new Error('JWT_SECRET must be configured with at least 32 characters in production');
if (isProduction && (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY)) throw new Error('Supabase Auth configuration is required in production');
if (isProduction && paymentProvider === 'mock') throw new Error('PAYMENT_PROVIDER=mock is not allowed in production.');
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
    // Never print or return authentication secrets, including OTPs.
    // Local/test environments must use the same delivery contract as production.
    return { delivered: true };
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

async function requestRefundForBooking(bookingId) {
  const payment=await repository.findPaymentByBooking(bookingId);
  if(!payment) return {status:'not_applicable'};
  if(payment.status==='refunded') return {status:'refunded',payment};
  if(!['paid','refund_pending'].includes(String(payment.status))) return {status:'not_eligible',payment};
  const claim=await repository.claimRefundRequest(payment.id);
  if(!claim.created) return {status:claim.status==='completed'?'refunded':'refund_pending',payment,idempotencyKey:claim.idempotencyKey};
  try {
    const providerResult=await payments.refundPayment({paymentId:payment.id,amountPaise:payment.amountPaise,providerOrderId:payment.providerOrderId,idempotencyKey:claim.idempotencyKey});
    if(providerResult?.confirmed && providerResult?.providerReference){
      const refunded=await repository.completePaymentRefund({paymentId:payment.id,providerReference:providerResult.providerReference});
      return {status:'refunded',payment:refunded,idempotencyKey:claim.idempotencyKey};
    }
    return {status:'refund_pending',payment,idempotencyKey:claim.idempotencyKey};
  } catch(error) {
    await repository.markRefundRetryable(payment.id).catch(()=>{});
    if(error.code==='UPI_PROVIDER_INTEGRATION_REQUIRED'||error.code==='PAYTM_ONBOARDING_REQUIRED') return {status:'refund_pending',payment,providerUnavailable:true,idempotencyKey:claim.idempotencyKey};
    throw error;
  }
}



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

    if (!identity?.id || !['customer','vendor','support','admin'].includes(identity.role)) {
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

async function resolveTrackingUser(token) {
  if(!token)return null;
  try{
    const user=await verifySupabaseAccessToken(token);
    if(!user?.id||!user?.email)return null;
    const metadata=user.user_metadata||{};
    let identity=await repository.findCustomerBySupabaseUserId(user.id);
    if(!identity)identity=await repository.findCustomerByEmail(user.email);
    if(!identity?.id){
      identity=await repository.createOrLinkCustomerFromSupabase({supabaseUserId:user.id,email:user.email,fullName:metadata.full_name||metadata.name||user.email.split('@')[0],phone:metadata.phone||undefined,role:'customer'});
    }
    if(!identity?.id||!['customer','vendor'].includes(identity.role))return null;
    return {id:identity.id,name:identity.fullName,role:identity.role,supabaseUserId:user.id,email:identity.email||user.email};
  }catch{return null;}
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error:{ code:'FORBIDDEN', message:'You do not have access to this resource.' } });
  }
  next();
};

const requireCustomer = requireRole('customer');
const requireSupport = requireRole('support','admin');

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

app.get('/api/v1/geocoding/search', supabaseRequireAuth, requireCustomer, async (req,res) => {
  const address=String(req.query.address||'').trim();
  const city=String(req.query.city||'').trim();
  if(address.length<4 || address.length>300 || city.length>100) return res.status(400).json({error:{code:'GEOCODE_INVALID_QUERY',message:'Enter a delivery address or landmark.'}});
  try {
    const result=await geocodeAddress(address,city);
    res.json({location:result.location,formattedAddress:result.formattedAddress,provider:result.provider,cached:Boolean(result.cached)});
  } catch(error) {
    const statusByCode={GEOCODE_INVALID_QUERY:400,GEOCODE_PROVIDER_NOT_CONFIGURED:503,GEOCODE_PROVIDER_UNAVAILABLE:503,GEOCODE_PROVIDER_TIMEOUT:504,GEOCODE_NOT_FOUND:422};
    const messages={
      GEOCODE_INVALID_QUERY:'Enter a delivery address or landmark.',
      GEOCODE_PROVIDER_NOT_CONFIGURED:'Address search is not configured yet. You can choose a point on the map.',
      GEOCODE_PROVIDER_UNAVAILABLE:'Address search is temporarily unavailable. Please retry or choose a point on the map.',
      GEOCODE_PROVIDER_TIMEOUT:'Address search took too long. Please retry.',
      GEOCODE_NOT_FOUND:'We could not find that address. Try a nearby landmark or choose a point on the map.',
    };
    console.error(JSON.stringify({level:'error',event:'geocoding_failed',requestId:req.requestId,code:error?.code||'GEOCODE_FAILED'}));
    res.status(statusByCode[error?.code]||503).json({error:{code:error?.code||'GEOCODE_FAILED',message:messages[error?.code]||'We could not find that address right now. Please retry.'}});
  }
});

app.get('/api/v1/routing/eta', supabaseRequireAuth, requireCustomer, async (req,res) => {
  const parsed=z.object({
    vendorId:z.string().uuid(),
    latitude:z.coerce.number().min(-90).max(90),
    longitude:z.coerce.number().min(-180).max(180),
  }).safeParse(req.query);
  if(!parsed.success) return res.status(400).json({error:{code:'ROUTE_INVALID_COORDINATES',message:'Please provide a valid delivery location.'}});
  try{
    const vendors=await repository.listMarketplaceVendors({});
    const vendor=vendors.find(item=>String(item.vendorId)===String(parsed.data.vendorId));
    if(!vendor) return res.status(404).json({error:{code:'VENDOR_NOT_FOUND',message:'Vendor service location is not available.'}});
    const route=await getDrivingRoute(
      {latitude:vendor.latitude,longitude:vendor.longitude},
      {latitude:parsed.data.latitude,longitude:parsed.data.longitude}
    );
    res.json({
      route:{
        distanceMeters:route.distanceMeters,
        durationSeconds:route.durationSeconds,
        estimatedDeliveryMinutes:Math.max(1,Math.round(route.durationSeconds/60)),
        provider:route.provider,
        cached:Boolean(route.cached),
      }
    });
  }catch(error){
    const statusByCode={
      ROUTE_INVALID_COORDINATES:400,
      ROUTE_PROVIDER_NOT_CONFIGURED:503,
      ROUTE_PROVIDER_UNAVAILABLE:503,
      ROUTE_PROVIDER_TIMEOUT:504,
      ROUTE_NOT_FOUND:422,
    };
    const status=statusByCode[error?.code]||503;
    const messages={
      ROUTE_PROVIDER_NOT_CONFIGURED:'Delivery routing is not configured yet.',
      ROUTE_PROVIDER_UNAVAILABLE:'Delivery routing is temporarily unavailable. Please retry.',
      ROUTE_PROVIDER_TIMEOUT:'Delivery routing took too long. Please retry.',
      ROUTE_NOT_FOUND:'No driving route was found for those locations.',
      ROUTE_INVALID_COORDINATES:'Please provide a valid delivery location.',
    };
    console.error(JSON.stringify({level:'error',event:'routing_eta_failed',requestId:req.requestId,code:error?.code||'ROUTE_FAILED'}));
    res.status(status).json({error:{code:error?.code||'ROUTE_FAILED',message:messages[error?.code]||'We could not estimate delivery time right now. Please retry.'}});
  }
});

app.get('/api/v1/vendors/map', async (req, res) => {
  try {
    const cityValue = req.query.city?.toString().trim() || undefined;
    if (cityValue && cityValue.length > 100) return res.status(400).json({error:{code:'INVALID_CITY',message:'City value is too long.'}});
    const city = cityValue;
    const vendors = await repository.listMarketplaceVendors({ city });
    res.json({ data: vendors, vendors, meta:{ count:vendors.length } });
  } catch (error) {
    console.error(JSON.stringify({level:'error',event:'vendor_map_failed',requestId:req.requestId,code:error?.code||'VENDOR_MAP_FAILED',message:error?.message}));
    res.status(503).json({error:{code:'VENDOR_MAP_UNAVAILABLE',message:'Vendor map data is temporarily unavailable. Please retry.'}});
  }
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
    const queryText = req.query.q?.toString() || '';
    if ((city && city.length > 100) || queryText.length > 100) return res.status(400).json({error:{code:'INVALID_VEHICLE_QUERY',message:'Search filters are too long.'}});
    const q = req.query.q?.toString().trim();
    const vehicles = await repository.listVehicles({ type, city, q });
    const data = vehicles.map(mobileVehicle);
    res.json({ data, vehicles: data, meta: { count: data.length, currency: 'INR' } });
  } catch (error) {
    console.error(JSON.stringify({ level:'error', event:'vehicles_list_failed', requestId:req.requestId, code:error?.code || 'VEHICLES_LIST_FAILED', message:error?.message }));
    res.status(503).json({ error:{ code:'VEHICLES_UNAVAILABLE', message:'Vehicle inventory is temporarily unavailable. Please retry.' } });
  }
});

app.get('/api/v1/vendors/:vendorId', async (req,res)=>{
  try{
    const vendor=await repository.getPublicVendorProfile(req.params.vendorId);
    if(!vendor)return res.status(404).json({error:{code:'VENDOR_NOT_FOUND',message:'Vendor not found.'}});
    res.json({vendor});
  }catch(error){
    console.error(JSON.stringify({level:'error',event:'vendor_profile_failed',requestId:req.requestId,code:error?.code||'VENDOR_PROFILE_FAILED'}));
    res.status(503).json({error:{code:'VENDOR_PROFILE_UNAVAILABLE',message:'Vendor information is temporarily unavailable. Please retry.'}});
  }
});

app.get('/api/v1/vendors/:vendorId/vehicles', async (req,res)=>{
  try{
    const vendor=await repository.getPublicVendorProfile(req.params.vendorId);
    if(!vendor)return res.status(404).json({error:{code:'VENDOR_NOT_FOUND',message:'Vendor not found.'}});
    const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));
    const offset=Math.max(0,Number(req.query.offset)||0);
    const vehicles=(await repository.listPublicVendorVehicles(req.params.vendorId,{limit,offset})).map(mobileVehicle);
    res.json({vendor,vehicles,data:vehicles,pagination:{limit,offset,count:vehicles.length}});
  }catch(error){
    console.error(JSON.stringify({level:'error',event:'vendor_fleet_failed',requestId:req.requestId,code:error?.code||'VENDOR_FLEET_FAILED'}));
    res.status(503).json({error:{code:'VENDOR_FLEET_UNAVAILABLE',message:'Vendor fleet is temporarily unavailable. Please retry.'}});
  }
});

app.post('/api/v1/quotes/multi', supabaseRequireAuth, requireCustomer, async (req,res)=>{
  const parsed=z.object({
    vehicleIds:z.array(z.string().trim().min(1).max(64)).min(2).max(10),
    pickupAt:z.string().datetime(),
    returnAt:z.string().datetime(),
    delivery:z.boolean().default(true),
    address:z.string().trim().max(300).default(''),
    deliveryLatitude:z.union([z.number(),z.string()]).nullable().optional(),
    deliveryLongitude:z.union([z.number(),z.string()]).nullable().optional(),
  }).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Provide valid fleet booking details.',details:parsed.error.flatten()}});
  try{
    const quote=await repository.quoteMultiVehicle({customerId:req.user.id,vehicleIds:parsed.data.vehicleIds,startAt:parsed.data.pickupAt,endAt:parsed.data.returnAt,delivery:parsed.data.delivery,address:parsed.data.address,deliveryLatitude:parsed.data.deliveryLatitude,deliveryLongitude:parsed.data.deliveryLongitude});
    res.json({quote});
  }catch(error){
    const map={INVALID_MULTI_CART:400,INVALID_BOOKING_WINDOW:400,INVALID_DELIVERY_LOCATION:400,MULTI_VEHICLE_ACCESS_DENIED:403,MULTI_VEHICLE_UNAVAILABLE:409,VENDOR_NOT_FOUND:404};
    res.status(map[error?.code]||503).json({error:{code:error?.code||'MULTI_QUOTE_FAILED',message:error?.code==='MULTI_VEHICLE_UNAVAILABLE'?'One or more selected vehicles are no longer available.':'We could not prepare the fleet quote right now. Please retry.',vehicleIds:error?.vehicleIds}});
  }
});

app.post('/api/v1/fleet-orders', supabaseRequireAuth, requireCustomer, async (req,res)=>{
  const parsed=z.object({
    vehicleIds:z.array(z.string().trim().min(1).max(64)).min(2).max(10),
    pickupAt:z.string().datetime(),
    returnAt:z.string().datetime(),
    delivery:z.boolean().default(true),
    address:z.string().trim().min(8).max(300),
    deliveryLatitude:z.union([z.number(),z.string()]).nullable().optional(),
    deliveryLongitude:z.union([z.number(),z.string()]).nullable().optional(),
  }).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Provide valid fleet checkout details.',details:parsed.error.flatten()}});
  const idempotencyKey=req.get('Idempotency-Key')?.trim()||null;
  if(idempotencyKey&&idempotencyKey.length>128)return res.status(400).json({error:{code:'INVALID_IDEMPOTENCY_KEY'}});
  try{
    const order=await repository.createFleetOrder({customerId:req.user.id,vehicleIds:parsed.data.vehicleIds,startAt:parsed.data.pickupAt,endAt:parsed.data.returnAt,delivery:parsed.data.delivery,address:parsed.data.address,deliveryLatitude:parsed.data.deliveryLatitude,deliveryLongitude:parsed.data.deliveryLongitude,idempotencyKey});
    res.status(201).json({order,data:order});
  }catch(error){
    const map={INVALID_MULTI_CART:400,INVALID_BOOKING_WINDOW:400,INVALID_DELIVERY_LOCATION:400,MULTI_VEHICLE_ACCESS_DENIED:403,MULTI_VEHICLE_UNAVAILABLE:409,VENDOR_NOT_FOUND:404,VEHICLE_NOT_FOUND:404};
    res.status(map[error?.code]||503).json({error:{code:error?.code||'FLEET_ORDER_FAILED',message:error?.code==='MULTI_VEHICLE_UNAVAILABLE'?'One or more selected vehicles became unavailable. No vehicles were booked.':'We could not create the fleet booking. Please retry.',vehicleIds:error?.vehicleIds}});
  }
});

app.get('/api/v1/fleet-orders/:id', supabaseRequireAuth, requireCustomer, async (req,res)=>{
  try{
    if(!repository.getFleetOrder) return res.status(404).json({error:{code:'FLEET_ORDER_NOT_FOUND',message:'Fleet booking not found.'}});
    const order=await repository.getFleetOrder(req.params.id,req.user.id);
    if(!order)return res.status(404).json({error:{code:'FLEET_ORDER_NOT_FOUND',message:'Fleet booking not found.'}});
    res.json({order});
  }catch(error){res.status(503).json({error:{code:'FLEET_ORDER_UNAVAILABLE',message:'Fleet booking is temporarily unavailable. Please retry.'}});}
});

app.post('/api/v1/fleet-orders/:id/payment', supabaseRequireAuth, requireCustomer, async (req,res)=>{
  const parsed=z.object({idempotencyKey:z.string().trim().min(8).max(128).optional()}).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Invalid payment request.'}});
  try{
    const order=await repository.getFleetOrder(req.params.id,req.user.id);
    if(!order)return res.status(404).json({error:{code:'FLEET_ORDER_NOT_FOUND',message:'Fleet booking not found.'}});
    if(order.paymentStatus==='paid')return res.status(409).json({error:{code:'PAYMENT_ALREADY_PAID',message:'This fleet booking is already paid.'}});
    if(new Date(order.quoteExpiresAt)<=new Date())return res.status(409).json({error:{code:'QUOTE_EXPIRED',message:'This fleet quote has expired. Please recheck availability.'}});
    const amountPaise=Math.round(Number(order.total)*100);
    const paymentRequest=await payments.createCustomerPayment({orderId:'rideon_fleet_'+order.id,amountPaise});
    const result=await repository.createFleetOrderPayment({orderId:order.id,customerId:req.user.id,provider:paymentProvider,amountPaise,idempotencyKey:parsed.data.idempotencyKey,providerOrder:{id:paymentRequest.providerOrderId,amountPaise:paymentRequest.amountPaise,currency:'INR'}});
    res.status(result.created?201:200).json({payment:{...result.payment,paymentUrl:paymentRequest.paymentUrl,amount:result.payment.amountPaise,currency:'INR'},order});
  }catch(error){
    const map={FLEET_ORDER_NOT_FOUND:404,PAYMENT_ALREADY_PAID:409,QUOTE_EXPIRED:409,PAYMENT_CREATION_FAILED:400,PAYMENT_PROVIDER_CONFIGURATION_REQUIRED:503,UPI_PROVIDER_INTEGRATION_REQUIRED:503};
    res.status(map[error?.code]||503).json({error:{code:error?.code||'FLEET_PAYMENT_FAILED',message:error?.code==='QUOTE_EXPIRED'?'This fleet quote has expired. Please recheck availability.':error?.code==='UPI_PROVIDER_INTEGRATION_REQUIRED'?'Verified UPI payment integration is not enabled for the configured provider yet.':'We could not start fleet checkout right now. Please retry.'}});
  }
});

app.get('/api/v1/fleet-orders', supabaseRequireAuth, requireCustomer, async (req,res)=>{
  try{
    const limit=Math.min(50,Math.max(1,Number(req.query.limit)||20));
    const offset=Math.max(0,Number(req.query.offset)||0);
    const orders=await repository.listCustomerFleetOrders(req.user.id,{limit,offset});
    res.json({orders,data:orders,pagination:{limit,offset,count:orders.length}});
  }catch(error){res.status(503).json({error:{code:'FLEET_ORDERS_UNAVAILABLE',message:'Fleet bookings are temporarily unavailable. Please retry.'}});}
});

app.get('/api/v1/me', supabaseRequireAuth, async (req, res) => {
  const customer = await repository.findCustomerById(req.user.id);
  if (!customer) return res.status(404).json({ error:{ code:'USER_NOT_FOUND' } });
  const user={id:customer.id,name:customer.fullName,email:customer.email||req.user.email,role:req.user.role};
  res.json({user,customer});
});

app.get('/api/v1/fleet', async (req,res)=>{
  const rawType=String(req.query.type||'').trim().toLowerCase();
  const type=rawType==='scooter'?'bike':rawType;
  if(type && !['bike','car'].includes(type)) return res.status(400).json({error:{code:'INVALID_VEHICLE_TYPE',message:'Choose a valid fleet vehicle type.'}});
  const sort=['recommended','price_asc','price_desc'].includes(String(req.query.sort||'').toLowerCase())?String(req.query.sort).toLowerCase():'recommended';
  try{
    const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50)),offset=Math.max(0,Number(req.query.offset)||0);
    const vehicles=await repository.listRideOnFleet({q:req.query.q,type,brand:req.query.brand,model:req.query.model,city:req.query.city,minPrice:req.query.minPrice,maxPrice:req.query.maxPrice,sort,limit,offset});
    res.json({fleet:vehicles,data:vehicles,vehicles,meta:{count:vehicles.length,limit,offset}});
  }catch(error){
    console.error(JSON.stringify({level:'error',event:'fleet_list_failed',requestId:req.requestId,code:error?.code||'FLEET_LIST_FAILED'}));
    res.status(503).json({error:{code:'FLEET_UNAVAILABLE',message:'RideOn fleet is temporarily unavailable. Please retry.'}});
  }
});

app.get('/api/v1/fleet/:vehicleId', async (req,res)=>{
  try{
    const vehicle=await repository.getRideOnFleetVehicle(req.params.vehicleId);
    if(!vehicle)return res.status(404).json({error:{code:'VEHICLE_NOT_FOUND',message:'Vehicle not found.'}});
    res.json({vehicle:mobileVehicle(vehicle),data:mobileVehicle(vehicle)});
  }catch(error){res.status(503).json({error:{code:'FLEET_UNAVAILABLE',message:'RideOn fleet is temporarily unavailable. Please retry.'}});}
});

app.get('/api/v1/fleet/:vehicleId/availability', supabaseRequireAuth, requireCustomer, async (req,res)=>{
  const parsed=z.object({startAt:z.string().datetime(),endAt:z.string().datetime()}).safeParse(req.query);
  if(!parsed.success)return res.status(400).json({error:{code:'INVALID_BOOKING_WINDOW',message:'Provide valid pickup and return timestamps.'}});
  try{
    validateBookingWindow(parsed.data.startAt,parsed.data.endAt);
    const availability=await repository.checkVehicleAvailability(req.params.vehicleId,parsed.data.startAt,parsed.data.endAt);
    if(!availability.exists)return res.status(404).json({error:{code:'VEHICLE_NOT_FOUND',message:'Vehicle not found.'}});
    res.json(availability);
  }catch(error){
    res.status(error?.code==='INVALID_BOOKING_WINDOW'?400:503).json({error:{code:error?.code||'FLEET_AVAILABILITY_FAILED',message:error?.message||'Fleet availability is temporarily unavailable.'}});
  }
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

app.get('/api/v1/vendor/service-location', supabaseRequireAuth, requireVendor, async (req,res) => {
  try {
    const location = await repository.getVendorServiceLocation(req.user.id);
    if (!location) return res.status(404).json({error:{code:'VENDOR_NOT_FOUND',message:'Vendor profile not found.'}});
    res.json({data:location,location});
  } catch (error) {
    console.error(JSON.stringify({level:'error',event:'vendor_service_location_get_failed',requestId:req.requestId,code:error?.code||'VENDOR_SERVICE_LOCATION_GET_FAILED'}));
    res.status(503).json({error:{code:'SERVICE_LOCATION_UNAVAILABLE',message:'We could not load your service location right now.'}});
  }
});

app.patch('/api/v1/vendor/service-location', supabaseRequireAuth, requireVendor, async (req,res) => {
  const parsed=z.object({
    latitude:z.union([z.number(),z.string()]).nullable().optional(),
    longitude:z.union([z.number(),z.string()]).nullable().optional(),
    address:z.string().trim().max(300).optional(),
    serviceCity:z.string().trim().min(2).max(100).optional(),
  }).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:{code:'INVALID_SERVICE_LOCATION',message:'Please provide a valid service location.',details:parsed.error.flatten()}});
  try {
    const location=await repository.updateVendorServiceLocation(req.user.id,parsed.data);
    if(!location) return res.status(404).json({error:{code:'VENDOR_NOT_FOUND',message:'Vendor profile not found.'}});
    res.json({data:{vendorId:location.id,serviceCity:location.serviceCity,address:location.serviceAddress||location.address,latitude:location.serviceLatitude,longitude:location.serviceLongitude},location:{vendorId:location.id,serviceCity:location.serviceCity,address:location.serviceAddress||location.address,latitude:location.serviceLatitude,longitude:location.serviceLongitude}});
  } catch(error) {
    if(error.code==='INVALID_SERVICE_LOCATION') return res.status(400).json({error:{code:error.code,message:'Please provide a valid latitude and longitude.'}});
    console.error(JSON.stringify({level:'error',event:'vendor_service_location_update_failed',requestId:req.requestId,code:error?.code||'SERVICE_LOCATION_UPDATE_FAILED'}));
    res.status(503).json({error:{code:'SERVICE_LOCATION_UPDATE_FAILED',message:'We could not save your service location right now. Please try again.'}});
  }
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
    if(!/^[A-Za-z0-9+/\s]+={0,2}$/.test(base64) || base64.length > Math.ceil((8*1024*1024)/3)*4 + 16){
      return res.status(400).json({error:{code:'IMAGE_INVALID',message:'The selected image could not be read. Please choose it again.'}});
    }
    const imageBuffer=Buffer.from(base64,'base64');
    if(!imageBuffer.length) return res.status(400).json({error:{code:'IMAGE_INVALID',message:'The selected image could not be read. Please choose it again.'}});
    if(imageBuffer.length>8*1024*1024) return res.status(413).json({error:{code:'IMAGE_TOO_LARGE',message:'Vehicle images must be 8 MB or smaller.'}});
    const hasJpegMagic=imageBuffer.length>=3&&imageBuffer[0]===0xFF&&imageBuffer[1]===0xD8&&imageBuffer[2]===0xFF;
    const hasPngMagic=imageBuffer.length>=8&&imageBuffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]));
    const hasWebpMagic=imageBuffer.length>=12&&imageBuffer.subarray(0,4).toString('ascii')==='RIFF'&&imageBuffer.subarray(8,12).toString('ascii')==='WEBP';
    const contentMatchesMagic=(contentType==='image/jpeg'&&hasJpegMagic)||(contentType==='image/png'&&hasPngMagic)||(contentType==='image/webp'&&hasWebpMagic);
    if(!contentMatchesMagic) return res.status(400).json({error:{code:'IMAGE_INVALID',message:'The selected file is not a valid image of the declared type.'}});
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
  res.json({data:publicBooking(booking,{includeDeliveryLocation:true}),booking:publicBooking(booking,{includeDeliveryLocation:true})});
});

const trackingUpdateRateLimit=rateLimit({windowMs:60_000,limit:40,standardHeaders:true,legacyHeaders:false});

app.post('/api/v1/vendor/bookings/:id/delivery/start', supabaseRequireAuth, requireVendor, async (req,res)=>{
  try{
    const session=await repository.startDelivery(req.vendor.id,req.params.id);
    res.json({tracking:{session,status:'in_delivery',active:true}});
  }catch(error){
    const map={BOOKING_NOT_FOUND:404,DELIVERY_START_NOT_ALLOWED:409,DELIVERY_LOCATION_REQUIRED:409,PAYMENT_REQUIRED_FOR_DELIVERY:409,DELIVERY_ALREADY_ACTIVE:409};
    const messages={DELIVERY_START_NOT_ALLOWED:'Delivery can only start after the booking is confirmed.',DELIVERY_LOCATION_REQUIRED:'A valid delivery address and map location are required before delivery can start.',PAYMENT_REQUIRED_FOR_DELIVERY:'Payment must be confirmed before delivery can start.',DELIVERY_ALREADY_ACTIVE:'Delivery tracking is already active.'};
    res.status(map[error?.code]||500).json({error:{code:error?.code||'DELIVERY_START_FAILED',message:messages[error?.code]||'We could not start delivery right now. Please try again.'}});
  }
});

app.post('/api/v1/vendor/bookings/:id/delivery/location', supabaseRequireAuth, requireVendor, trackingUpdateRateLimit, async (req,res)=>{
  const parsed=z.object({latitude:z.coerce.number().min(-90).max(90),longitude:z.coerce.number().min(-180).max(180),accuracyMeters:z.coerce.number().min(0).max(10000).optional(),recordedAt:z.string().datetime().optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:{code:'INVALID_DELIVERY_LOCATION',message:'We could not use that GPS location. Please try again.'}});
  try{
    const booking=await repository.getVendorBooking(req.vendor.id,req.params.id);
    if(!booking)return res.status(404).json({error:{code:'BOOKING_NOT_FOUND',message:'Booking not found.'}});
    const before=await repository.getActiveTrackingSession(req.vendor.id,req.params.id);
    const session=await repository.updateDeliveryLocation(req.vendor.id,req.params.id,parsed.data);
    let route=null; let routeUnavailable=false;
    const movedMeters=before?.lastLatitude!=null?Math.sqrt(Math.pow((parsed.data.latitude-before.lastLatitude)*111320,2)+Math.pow((parsed.data.longitude-before.lastLongitude)*111320*Math.cos(parsed.data.latitude*Math.PI/180),2)):Infinity;
    const routeDue=!before?.lastRouteAt||Date.now()-new Date(before.lastRouteAt).getTime()>=Math.max(30,Number(process.env.TRACKING_ROUTE_REFRESH_SECONDS||60))*1000||movedMeters>=Math.max(100,Number(process.env.TRACKING_ROUTE_REFRESH_METERS||300));
    if(routeDue&&booking.deliveryLatitude!=null&&booking.deliveryLongitude!=null){
      try{
        const calculated=await getDrivingRoute({latitude:parsed.data.latitude,longitude:parsed.data.longitude},{latitude:booking.deliveryLatitude,longitude:booking.deliveryLongitude});
        route={distanceMeters:calculated.distanceMeters,durationSeconds:calculated.durationSeconds,estimatedDeliveryMinutes:Math.max(1,Math.round(calculated.durationSeconds/60)),provider:calculated.provider,encodedPolyline:calculated.encodedPolyline||null};
        await repository.updateTrackingRoute(req.vendor.id,req.params.id,route);
      }catch(routeError){
        routeUnavailable=true;
        if(routeError?.code!=='ROUTE_PROVIDER_NOT_CONFIGURED'&&routeError?.code!=='ROUTE_PROVIDER_UNAVAILABLE'&&routeError?.code!=='ROUTE_PROVIDER_TIMEOUT'&&routeError?.code!=='ROUTE_NOT_FOUND')throw routeError;
      }
    }
    const latest=await repository.getActiveTrackingSession(req.vendor.id,req.params.id);
    const payload={type:'tracking.update',tracking:{session:latest||session,location:{latitude:parsed.data.latitude,longitude:parsed.data.longitude,accuracyMeters:parsed.data.accuracyMeters||null,updatedAt:parsed.data.recordedAt||new Date().toISOString()},route,routeUnavailable}};
    trackingRealtime.broadcast(req.params.id,payload);
    res.json({tracking:payload.tracking});
  }catch(error){
    const map={BOOKING_NOT_FOUND:404,TRACKING_NOT_ACTIVE:409,TRACKING_SESSION_EXPIRED:409,STALE_LOCATION_UPDATE:409,INVALID_DELIVERY_LOCATION:400,INVALID_DELIVERY_TIMESTAMP:400};
    const messages={TRACKING_NOT_ACTIVE:'Live delivery tracking is not active.',TRACKING_SESSION_EXPIRED:'This delivery tracking session has expired.',STALE_LOCATION_UPDATE:'That GPS update is older than the last accepted location.',INVALID_DELIVERY_LOCATION:'We could not use that GPS location. Please try again.',INVALID_DELIVERY_TIMESTAMP:'That GPS timestamp is invalid.'};
    res.status(map[error?.code]||500).json({error:{code:error?.code||'DELIVERY_LOCATION_UPDATE_FAILED',message:messages[error?.code]||'We could not update the delivery location right now. Please retry.'}});
  }
});

app.post('/api/v1/vendor/bookings/:id/delivery/complete', supabaseRequireAuth, requireVendor, async (req,res)=>{
  const parsed=z.object({latitude:z.coerce.number().min(-90).max(90).nullable().optional(),longitude:z.coerce.number().min(-180).max(180).nullable().optional()}).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:{code:'INVALID_DELIVERY_LOCATION',message:'The final delivery location is invalid.'}});
  try{
    const result=await repository.completeDelivery(req.vendor.id,req.params.id,parsed.data);
    trackingRealtime.broadcast(req.params.id,{type:'tracking.completed',tracking:{session:result.session,booking:publicBooking(result.booking)}});
    res.json({booking:publicBooking(result.booking),tracking:{session:result.session,status:'delivered',active:false}});
  }catch(error){
    const map={BOOKING_NOT_FOUND:404,TRACKING_NOT_ACTIVE:409,TRACKING_SESSION_EXPIRED:409,DELIVERY_COMPLETION_NOT_ALLOWED:409,INVALID_DELIVERY_LOCATION:400};
    const messages={TRACKING_NOT_ACTIVE:'Live delivery tracking is not active.',TRACKING_SESSION_EXPIRED:'This delivery session has expired.',DELIVERY_COMPLETION_NOT_ALLOWED:'Delivery cannot be completed in the current booking state.',INVALID_DELIVERY_LOCATION:'The final delivery location is invalid.'};
    res.status(map[error?.code]||500).json({error:{code:error?.code||'DELIVERY_COMPLETION_FAILED',message:messages[error?.code]||'We could not mark the vehicle delivered right now. Please retry.'}});
  }
});

app.post('/api/v1/vendor/bookings/:id/delivery/abort', supabaseRequireAuth, requireVendor, async (req,res)=>{
  try{
    const result=await repository.abortDelivery(req.vendor.id,req.params.id);
    trackingRealtime.broadcast(req.params.id,{type:'tracking.stopped',tracking:{session:result.session,status:'aborted',active:false}});
    res.json({booking:publicBooking(result.booking),tracking:{session:result.session,status:'aborted',active:false}});
  }catch(error){
    const map={BOOKING_NOT_FOUND:404,TRACKING_NOT_ACTIVE:409};
    res.status(map[error?.code]||500).json({error:{code:error?.code||'DELIVERY_ABORT_FAILED',message:error?.code==='TRACKING_NOT_ACTIVE'?'Live delivery tracking is not active.':'We could not stop delivery tracking right now. Please retry.'}});
  }
});

app.get('/api/v1/bookings/:id/tracking', supabaseRequireAuth, requireCustomer, async (req,res)=>{
  try{
    const result=await repository.getTrackingForCustomer(req.user.id,req.params.id);
    const staleThresholdSeconds=Math.max(30,Number(process.env.TRACKING_STALE_SECONDS||90));
    const last=result.session?.lastLocationAt?new Date(result.session.lastLocationAt).getTime():0;
    const stale=!last||Date.now()-last>staleThresholdSeconds*1000;
    const active=Boolean(result.session?.status==='active'&&result.booking.deliveryStatus==='in_delivery'&&!stale);
    res.json({tracking:{active,stale,staleThresholdSeconds,session:result.session,booking:publicBooking(result.booking,{includeDeliveryLocation:active})}});
  }catch(error){
    res.status(error?.code==='BOOKING_NOT_FOUND'?404:500).json({error:{code:error?.code||'TRACKING_UNAVAILABLE',message:error?.code==='BOOKING_NOT_FOUND'?'Booking not found.':'We could not load live delivery tracking right now. Please retry.'}});
  }
});

app.get('/api/v1/vendor/bookings/:id/customer-reviews', supabaseRequireAuth, requireVendor, async (req,res)=>{
  try{
    const booking=await repository.getVendorBooking(req.vendor.id,req.params.id);
    if(!booking)return res.status(404).json({error:{code:'BOOKING_NOT_FOUND',message:'Booking not found.'}});
    const customerId=booking.customerId;
    const result=await repository.listVendorCustomerReviewsForBooking({vendorId:req.vendor.id,bookingId:req.params.id,limit:10,offset:0});
    res.json(result);
  }catch(error){res.status(500).json({error:{code:'REVIEWS_UNAVAILABLE',message:'We could not load customer rating history right now. Please retry.'}});}
});

app.get('/api/v1/vendor/fleet-orders', supabaseRequireAuth, requireVendor, async (req,res)=>{
  try{
    const limit=Math.min(50,Math.max(1,Number(req.query.limit)||20));
    const offset=Math.max(0,Number(req.query.offset)||0);
    const orders=await repository.listVendorFleetOrders(req.vendor.id,{limit,offset});
    res.json({orders,data:orders,pagination:{limit,offset,count:orders.length}});
  }catch(error){res.status(503).json({error:{code:'FLEET_ORDERS_UNAVAILABLE',message:'Grouped fleet bookings are temporarily unavailable. Please retry.'}});}
});

app.get('/api/v1/vendor/fleet-orders/:id', supabaseRequireAuth, requireVendor, async (req,res)=>{
  try{
    const orders=await repository.listVendorFleetOrders(req.vendor.id,{limit:50,offset:0});
    const order=orders.find(x=>String(x.id)===String(req.params.id));
    if(!order)return res.status(404).json({error:{code:'FLEET_ORDER_NOT_FOUND',message:'Fleet booking not found.'}});
    res.json({order});
  }catch(error){res.status(503).json({error:{code:'FLEET_ORDER_UNAVAILABLE',message:'Fleet booking is temporarily unavailable. Please retry.'}});}
});

app.patch('/api/v1/vendor/fleet-orders/:id/status', supabaseRequireAuth, requireVendor, async (req,res)=>{
  const parsed=z.object({status:z.enum(['confirmed','rejected','cancelled','in_progress','completed']),note:z.string().trim().max(500).optional()}).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:{code:'INVALID_BOOKING_STATUS',message:'Invalid grouped booking status.',details:parsed.error.flatten()}});
  try{
    const order=await repository.updateFleetOrderStatus(req.vendor.id,req.params.id,parsed.data.status,parsed.data.note);
    res.json({order});
  }catch(error){
    const map={BOOKING_NOT_FOUND:404,INVALID_BOOKING_STATUS:400,INVALID_BOOKING_TRANSITION:409,PAYMENT_REQUIRED_FOR_ACCEPTANCE:409,DELIVERY_NOT_COMPLETED:409,REJECTION_REASON_REQUIRED:400};
    res.status(map[error?.code]||503).json({error:{code:error?.code||'FLEET_ORDER_STATUS_FAILED',message:error?.code==='PAYMENT_REQUIRED_FOR_ACCEPTANCE'?'Payment must be confirmed before accepting the grouped booking.':error?.code==='DELIVERY_NOT_COMPLETED'?'Complete delivery for every vehicle before completing the grouped booking.':error?.code==='REJECTION_REASON_REQUIRED'?'A rejection reason is required.':'We could not update the grouped booking right now. Please retry.'}});
  }
});

app.patch('/api/v1/vendor/bookings/:id/status', supabaseRequireAuth, requireVendor, async (req,res)=>{
  const parsed=z.object({status:z.enum(['confirmed','rejected','cancelled','in_progress','completed']),note:z.string().trim().max(500).optional()}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:{code:'INVALID_BOOKING_STATUS',message:'Invalid booking status.',details:parsed.error.flatten()}});
  try{
    const booking=await repository.updateVendorBookingStatus(req.vendor.id,req.params.id,parsed.data.status,parsed.data.note);
    const refund=(parsed.data.status==='rejected'&&['paid','refund_pending'].includes(String(booking.paymentStatus))) ? await requestRefundForBooking(booking.id) : {status:'not_applicable'};
    const latest=await repository.getVendorBooking(req.vendor.id,req.params.id);
    res.json({data:publicBooking(latest||booking,{includeDeliveryLocation:true}),booking:publicBooking(latest||booking,{includeDeliveryLocation:true}),refund});
  }catch(error){
    if(error.code==='BOOKING_NOT_FOUND') return res.status(404).json({error:{code:error.code,message:'Booking not found.'}});
    if(error.code==='INVALID_BOOKING_TRANSITION') return res.status(409).json({error:{code:error.code,message:'Booking cannot move to that status.'}});
    if(error.code==='PAYMENT_REQUIRED_FOR_ACCEPTANCE') return res.status(409).json({error:{code:error.code,message:'Payment must be confirmed before this booking can be accepted.'}});
    if(error.code==='INVALID_BOOKING_STATUS') return res.status(400).json({error:{code:error.code,message:'Invalid booking status.'}});
    if(error.code==='REJECTION_REASON_REQUIRED') return res.status(400).json({error:{code:error.code,message:'A rejection reason is required.'}});
    if(error.code==='DELIVERY_NOT_COMPLETED') return res.status(409).json({error:{code:error.code,message:'Mark the vehicle delivered before completing the rental.'}});
    throw error;
  }
});

const reviewResponse = (res, error) => {
  const map = {
    BOOKING_NOT_FOUND:[404,'Booking not found.'],
    REVIEW_NOT_ELIGIBLE:[409,'Reviews are available only after the booking is completed.'],
    REVIEW_ALREADY_EXISTS:[409,'You have already reviewed this booking.'],
    INVALID_REVIEW_RATING:[400,'Choose a star rating from 1 to 5.'],
    REVIEW_TARGET_UNAVAILABLE:[409,'The review target is not available for this booking.'],
    REVIEW_NOT_FOUND:[404,'Review not found.'],
    REVIEW_EDIT_NOT_ALLOWED:[403,'Vendor reviews cannot be edited after submission.'],
    REVIEW_EDIT_WINDOW_EXPIRED:[409,'This review can no longer be edited.'],
    FORBIDDEN:[403,'You do not have permission to perform this review action.'],
  };
  const [status,message]=map[error?.code]||[500,'We could not complete that review action right now. Please try again.'];
  return res.status(status).json({error:{code:error?.code||'REVIEW_FAILED',message}});
};

const supportResponse = (res, error) => {
  const map = {
    FORBIDDEN:[403,'FORBIDDEN','You do not have access to this support resource.'],
    BOOKING_NOT_FOUND:[404,'BOOKING_NOT_FOUND','Booking not found.'],
    VENDOR_NOT_FOUND:[404,'VENDOR_NOT_FOUND','Vendor profile not found.'],
    SUPPORT_TICKET_NOT_FOUND:[404,'SUPPORT_TICKET_NOT_FOUND','Support ticket not found.'],
    INVALID_SUPPORT_CATEGORY:[400,'INVALID_SUPPORT_CATEGORY','Choose a valid support category.'],
    INVALID_SUPPORT_PRIORITY:[400,'INVALID_SUPPORT_PRIORITY','Choose a valid priority.'],
    INVALID_SUPPORT_STATUS:[400,'INVALID_SUPPORT_STATUS','Choose a valid ticket status.'],
    INVALID_SUPPORT_SUBJECT:[400,'INVALID_SUPPORT_SUBJECT','Please enter a clear support subject.'],
    INVALID_SUPPORT_DESCRIPTION:[400,'INVALID_SUPPORT_DESCRIPTION','Please describe the issue in at least 10 characters.'],
    INVALID_SUPPORT_MESSAGE:[400,'INVALID_SUPPORT_MESSAGE','Please enter a message of up to 5000 characters.'],
    INVALID_SUPPORT_TRANSITION:[409,'INVALID_SUPPORT_TRANSITION','That ticket status change is not available.'],
    SUPPORT_TICKET_CLOSED:[409,'SUPPORT_TICKET_CLOSED','Reopen the ticket before replying.'],
    RESOLUTION_REQUIRED:[400,'RESOLUTION_REQUIRED','Add a resolution before marking the ticket resolved.'],
    INVALID_ASSIGNEE:[400,'INVALID_ASSIGNEE','Tickets can only be assigned to support staff.'],
    INVALID_IDEMPOTENCY_KEY:[400,'INVALID_IDEMPOTENCY_KEY','The support request key is invalid.'],
  };
  const [status,code,message]=map[error?.code]||[503,'SUPPORT_UNAVAILABLE','Support is temporarily unavailable. Please retry.'];
  console.error(JSON.stringify({level:'error',event:'support_request_failed',requestId:res.req?.requestId,code:error?.code||'SUPPORT_UNAVAILABLE'}));
  return res.status(status).json({error:{code,message}});
};

app.post('/api/v1/support/tickets', supabaseRequireAuth, requireRole('customer','vendor'), supportRateLimit, async (req,res)=>{
  const parsed=z.object({
    bookingId:z.string().uuid().nullable().optional(),
    category:z.string().trim().max(40),
    subject:z.string().trim().min(3).max(160),
    description:z.string().trim().min(10).max(5000),
    priority:z.enum(['low','normal','high','urgent']).default('normal'),
  }).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Please check the support request details.',details:parsed.error.flatten()}});
  try{
    const result=await repository.createSupportTicket({...parsed.data,raisedByUserId:req.user.id,raisedByRole:req.user.role,idempotencyKey:req.get('Idempotency-Key')||null});
    res.status(result.idempotentReplay?200:201).json({ticket:result.ticket,idempotentReplay:result.idempotentReplay});
  }catch(error){return supportResponse(res,error);}
});

app.get('/api/v1/support/tickets', supabaseRequireAuth, requireRole('customer','vendor'), async (req,res)=>{
  try{
    const result=await repository.listMySupportTickets({userId:req.user.id,role:req.user.role,status:req.query.status,category:req.query.category,limit:req.query.limit,offset:req.query.offset});
    res.json(result);
  }catch(error){return supportResponse(res,error);}
});

app.get('/api/v1/support/tickets/:id', supabaseRequireAuth, requireRole('customer','vendor','support','admin'), async (req,res)=>{
  try{
    const ticket=await repository.getSupportTicket({ticketId:req.params.id,userId:req.user.id,role:req.user.role});
    if(!ticket)return res.status(404).json({error:{code:'SUPPORT_TICKET_NOT_FOUND',message:'Support ticket not found.'}});
    res.json({ticket});
  }catch(error){return supportResponse(res,error);}
});

app.get('/api/v1/support/tickets/:id/messages', supabaseRequireAuth, requireRole('customer','vendor','support','admin'), async (req,res)=>{
  try{
    const messages=await repository.listSupportMessages({ticketId:req.params.id,userId:req.user.id,role:req.user.role});
    if(!messages)return res.status(404).json({error:{code:'SUPPORT_TICKET_NOT_FOUND',message:'Support ticket not found.'}});
    res.json({messages});
  }catch(error){return supportResponse(res,error);}
});

app.post('/api/v1/support/tickets/:id/messages', supabaseRequireAuth, requireRole('customer','vendor','support','admin'), supportRateLimit, async (req,res)=>{
  const parsed=z.object({message:z.string().trim().min(1).max(5000),isInternal:z.boolean().optional().default(false)}).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Please enter a message of up to 5000 characters.'}});
  try{
    const message=await repository.addSupportMessage({ticketId:req.params.id,userId:req.user.id,role:req.user.role,message:parsed.data.message,isInternal:parsed.data.isInternal});
    res.status(201).json({message});
  }catch(error){return supportResponse(res,error);}
});

app.post('/api/v1/support/tickets/:id/close', supabaseRequireAuth, requireRole('customer','vendor','support','admin'), supportRateLimit, async (req,res)=>{
  try{res.json({ticket:await repository.closeSupportTicket({ticketId:req.params.id,userId:req.user.id,role:req.user.role})});}
  catch(error){return supportResponse(res,error);}
});

app.post('/api/v1/support/tickets/:id/reopen', supabaseRequireAuth, requireRole('customer','vendor','support','admin'), supportRateLimit, async (req,res)=>{
  try{res.json({ticket:await repository.reopenSupportTicket({ticketId:req.params.id,userId:req.user.id,role:req.user.role})});}
  catch(error){return supportResponse(res,error);}
});

app.get('/api/v1/support/admin/tickets', supabaseRequireAuth, requireSupport, async (req,res)=>{
  try{
    const result=await repository.listSupportTickets({userId:req.user.id,status:req.query.status,category:req.query.category,priority:req.query.priority,limit:req.query.limit,offset:req.query.offset});
    res.json(result);
  }catch(error){return supportResponse(res,error);}
});

app.patch('/api/v1/support/admin/tickets/:id/assignment', supabaseRequireAuth, requireSupport, async (req,res)=>{
  const parsed=z.object({assignedToUserId:z.string().uuid()}).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Provide a valid support assignee.'}});
  try{res.json({ticket:await repository.assignSupportTicket({ticketId:req.params.id,assignedToUserId:parsed.data.assignedToUserId,actorUserId:req.user.id})});}
  catch(error){return supportResponse(res,error);}
});

app.patch('/api/v1/support/admin/tickets/:id/status', supabaseRequireAuth, requireSupport, async (req,res)=>{
  const parsed=z.object({status:z.enum(['open','in_progress','waiting_for_user','resolved','closed']),resolution:z.string().trim().max(5000).optional().nullable()}).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Provide a valid status and optional resolution.'}});
  try{res.json({ticket:await repository.updateSupportTicketStatus({ticketId:req.params.id,userId:req.user.id,role:req.user.role,status:parsed.data.status,resolution:parsed.data.resolution})});}
  catch(error){return supportResponse(res,error);}
});

app.post('/api/v1/support/admin/tickets/:id/messages', supabaseRequireAuth, requireSupport, supportRateLimit, async (req,res)=>{
  const parsed=z.object({message:z.string().trim().min(1).max(5000),isInternal:z.boolean().optional().default(false)}).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Please enter a message of up to 5000 characters.'}});
  try{res.status(201).json({message:await repository.addSupportMessage({ticketId:req.params.id,userId:req.user.id,role:req.user.role,message:parsed.data.message,isInternal:parsed.data.isInternal})});}
  catch(error){return supportResponse(res,error);}
});

app.post('/api/v1/support/admin/tickets/:id/resolve', supabaseRequireAuth, requireSupport, async (req,res)=>{
  const parsed=z.object({resolution:z.string().trim().min(3).max(5000)}).safeParse(req.body||{});
  if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'A resolution is required.'}});
  try{res.json({ticket:await repository.resolveSupportTicket({ticketId:req.params.id,userId:req.user.id,resolution:parsed.data.resolution})});}
  catch(error){return supportResponse(res,error);}
});

app.post('/api/v1/bookings/:id/reviews/customer', supabaseRequireAuth, requireCustomer, reviewRateLimit, async (req,res)=>{
  const parsed=z.object({rating:z.coerce.number().int().min(1).max(5),comment:z.string().trim().max(1000).optional().nullable()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:{code:'INVALID_REVIEW',message:'Choose a rating from 1 to 5 and keep the comment within 1000 characters.'}});
  try{
    const review=await repository.createReview({bookingId:req.params.id,reviewerId:req.user.id,reviewerRole:'customer',...parsed.data});
    res.status(201).json({review});
  }catch(error){return reviewResponse(res,error);}
});

app.post('/api/v1/vendor/bookings/:id/review', supabaseRequireAuth, requireVendor, reviewRateLimit, async (req,res)=>{
  const parsed=z.object({rating:z.coerce.number().int().min(1).max(5),comment:z.string().trim().max(1000).optional().nullable()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:{code:'INVALID_REVIEW',message:'Choose a rating from 1 to 5 and keep the comment within 1000 characters.'}});
  try{const review=await repository.createReview({bookingId:req.params.id,reviewerId:req.user.id,reviewerRole:'vendor',...parsed.data});res.status(201).json({review});}catch(error){return reviewResponse(res,error);}
});

app.post('/api/v1/vendor/bookings/:id/reviews/customer', supabaseRequireAuth, requireVendor, reviewRateLimit, async (req,res)=>{
  const parsed=z.object({rating:z.coerce.number().int().min(1).max(5),comment:z.string().trim().max(1000).optional().nullable()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:{code:'INVALID_REVIEW',message:'Choose a rating from 1 to 5 and keep the comment within 1000 characters.'}});
  try{
    const review=await repository.createReview({bookingId:req.params.id,reviewerId:req.user.id,reviewerRole:'vendor',...parsed.data});
    res.status(201).json({review});
  }catch(error){return reviewResponse(res,error);}
});

app.get('/api/v1/bookings/:id/reviews/status', supabaseRequireAuth, async (req,res)=>{
  if(!['customer','vendor'].includes(req.user.role))return res.status(403).json({error:{code:'FORBIDDEN',message:'A valid RideOn account is required.'}});
  try{res.json({data:await repository.getReviewStatus({bookingId:req.params.id,userId:req.user.id,role:req.user.role})});}
  catch(error){return reviewResponse(res,error);}
});

app.patch('/api/v1/reviews/:id', supabaseRequireAuth, requireCustomer, reviewRateLimit, async (req,res)=>{
  const parsed=z.object({rating:z.coerce.number().int().min(1).max(5),comment:z.string().trim().max(1000).optional().nullable()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:{code:'INVALID_REVIEW',message:'Choose a rating from 1 to 5 and keep the comment within 1000 characters.'}});
  try{res.json({review:await repository.updateReview({reviewId:req.params.id,userId:req.user.id,role:'customer',...parsed.data})});}
  catch(error){return reviewResponse(res,error);}
});

app.get('/api/v1/vehicles/:id/reviews', supabaseRequireAuth, async (req,res)=>{
  try{res.json(await repository.listReviews({scope:'vehicle',id:req.params.id,limit:req.query.limit,offset:req.query.offset}));}
  catch(error){return res.status(500).json({error:{code:'REVIEWS_UNAVAILABLE',message:'We could not load vehicle reviews right now. Please retry.'}});}
});

app.get('/api/v1/vendors/:id/reviews', supabaseRequireAuth, async (req,res)=>{
  try{res.json(await repository.listReviews({scope:'vendor',id:req.params.id,limit:req.query.limit,offset:req.query.offset}));}
  catch(error){return res.status(500).json({error:{code:'REVIEWS_UNAVAILABLE',message:'We could not load vendor reviews right now. Please retry.'}});}
});

app.get('/api/v1/me/reviews', supabaseRequireAuth, async (req,res)=>{
  try{res.json(await repository.listReviewsReceived(req.user.id,{limit:req.query.limit,offset:req.query.offset}));}
  catch(error){return res.status(500).json({error:{code:'REVIEWS_UNAVAILABLE',message:'We could not load your reviews right now. Please retry.'}});}
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
          message:'Unable to send the RideOn verification email right now.'
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
    console.log('[RideOnAuth][IDENTITY_LINK_START]', JSON.stringify({requestId:req.requestId, accountType:parsed.data.accountType}));
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
      return res.status(response.status===429?429:401).json({ error:{ code:'OTP_VERIFICATION_FAILED', message:'The verification code is invalid or expired.' } });
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

app.post('/api/v1/bookings/:id/route', supabaseRequireAuth, requireCustomer, async (req,res) => {
  try {
    const booking=await repository.getBooking(req.params.id,req.user.id);
    if(!booking) return res.status(404).json({error:{code:'BOOKING_NOT_FOUND',message:'Booking not found.'}});
    if(!booking.delivery || booking.deliveryLatitude==null || booking.deliveryLongitude==null) return res.status(409).json({error:{code:'ROUTE_LOCATION_REQUIRED',message:'A delivery location is required before estimating delivery time.'}});
    if(booking.vendorServiceLatitude==null || booking.vendorServiceLongitude==null) return res.status(409).json({error:{code:'VENDOR_SERVICE_LOCATION_UNAVAILABLE',message:'The selected vendor has not set a service location yet.'}});
    const route=await getDrivingRoute(
      {latitude:booking.vendorServiceLatitude,longitude:booking.vendorServiceLongitude},
      {latitude:booking.deliveryLatitude,longitude:booking.deliveryLongitude}
    );
    const updated=await repository.updateBookingRouteData(req.params.id,req.user.id,route);
    res.json({route:{...route,estimatedDeliveryMinutes:Math.max(1,Math.round(route.durationSeconds/60))},booking:publicBooking(updated||booking)});
  } catch(error) {
    const statusByCode={ROUTE_LOCATION_REQUIRED:409,VENDOR_SERVICE_LOCATION_UNAVAILABLE:409,ROUTE_INVALID_COORDINATES:400,ROUTE_PROVIDER_NOT_CONFIGURED:503,ROUTE_PROVIDER_UNAVAILABLE:503,ROUTE_PROVIDER_TIMEOUT:504,ROUTE_NOT_FOUND:422};
    const messages={ROUTE_LOCATION_REQUIRED:'A delivery location is required before estimating delivery time.',VENDOR_SERVICE_LOCATION_UNAVAILABLE:'The selected vendor has not set a service location yet.',ROUTE_INVALID_COORDINATES:'Please choose a valid delivery location.',ROUTE_PROVIDER_NOT_CONFIGURED:'Delivery routing is not configured yet.',ROUTE_PROVIDER_UNAVAILABLE:'Delivery routing is temporarily unavailable. Please retry.',ROUTE_PROVIDER_TIMEOUT:'Delivery routing took too long. Please retry.',ROUTE_NOT_FOUND:'No driving route was found for these locations.'};
    console.error(JSON.stringify({level:'error',event:'booking_route_failed',requestId:req.requestId,code:error?.code||'ROUTE_FAILED'}));
    res.status(statusByCode[error?.code]||503).json({error:{code:error?.code||'ROUTE_FAILED',message:messages[error?.code]||'We could not estimate delivery time right now. Please retry.'}});
  }
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
      deliveryLatitude: parsed.data.deliveryLatitude,
      deliveryLongitude: parsed.data.deliveryLongitude,
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

app.get('/api/v1/bookings/:id/cancellation-preview', supabaseRequireAuth, requireCustomer, async (req,res) => {
  try {
    const preview=await repository.getCancellationPreview(req.params.id,req.user.id);
    res.json({cancellation:preview});
  } catch(error) {
    if(error.code==='BOOKING_NOT_FOUND') return res.status(404).json({error:{code:'BOOKING_NOT_FOUND',message:'Booking not found.'}});
    if(error.code==='CANCELLATION_NOT_ALLOWED') return res.status(409).json({error:{code:error.code,message:'This booking can no longer be cancelled.'}});
    throw error;
  }
});

app.patch('/api/v1/bookings/:id/cancel', supabaseRequireAuth, requireCustomer, async (req,res) => {
  const parsed=z.object({reason:z.string().trim().max(500).optional()}).safeParse(req.body||{});
  if(!parsed.success) return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Invalid cancellation request.'}});
  try {
    const result=await repository.cancelBooking(req.params.id,req.user.id,{reason:parsed.data.reason||'customer_cancelled'});
    const refund=result.calculation.totalRefund>0 ? await requestRefundForBooking(req.params.id) : {status:'not_applicable'};
    const latest=await repository.getBooking(req.params.id,req.user.id);
    res.json({data:publicBooking(latest||result.booking),booking:publicBooking(latest||result.booking),cancellation:result.calculation,refund});
  } catch(error) {
    if(error.code==='BOOKING_NOT_FOUND') return res.status(404).json({error:{code:error.code,message:'Booking not found.'}});
    if(error.code==='CANCELLATION_NOT_ALLOWED') return res.status(409).json({error:{code:error.code,message:'This booking can no longer be cancelled.'}});
    if(error.code==='INVALID_PAYMENT_STATE') return res.status(409).json({error:{code:error.code,message:'The payment is not in a refundable state.'}});
    throw error;
  }
});

app.post('/api/v1/payments/create-order', supabaseRequireAuth, requireCustomer, paymentRateLimit, async (req,res) => {
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
    if(error.code==='PAYMENT_PROVIDER_CONFIGURATION_REQUIRED'||error.code==='PAYMENT_NOT_CONFIGURED') return res.status(503).json({error:{code:'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED',message:'Online payment is not configured on the RideOn server.'}});
    if(error.code==='PAYMENT_CREATION_FAILED') return res.status(502).json({error:{code:error.code,message:error.message}});
    if(error.code==='UPI_PROVIDER_INTEGRATION_REQUIRED') return res.status(503).json({error:{code:error.code,message:'UPI checkout is not enabled for the configured payment provider yet.'}});
    if(error.code==='PAYMENT_PROVIDER_CONFIGURATION_REQUIRED'||error.code==='UPI_PROVIDER_INTEGRATION_REQUIRED'||error.code==='PAYTM_ONBOARDING_REQUIRED') return res.status(503).json({error:{code:error.code,message:'Verified UPI payment integration is not enabled for the configured provider. No payment has been marked successful.'}});
    if(error.code==='PAYMENT_ALREADY_PAID') return res.status(409).json({error:{code:error.code,message:'This booking is already paid.'}});
    throw error;
  }
});

app.post('/api/v1/payments/:id/verify', supabaseRequireAuth, requireCustomer, paymentRateLimit, async (req,res) => {
  const parsed=z.object({ bookingId:z.string().uuid() }).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Provide a valid bookingId.'}});
  let payment=await repository.findPaymentById(req.params.id, req.user.id);
  if(!payment || String(payment.bookingId)!==String(parsed.data.bookingId)) return res.status(404).json({error:{code:'PAYMENT_NOT_FOUND',message:'Payment not found.'}});
  if(String(payment.status).toLowerCase()==='paid') return res.json({payment,verification:'already_verified',bookingPaymentStatus:'paid'});
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
  const signature = req.get('X-Payment-Signature') || req.get('X-Paytm-Signature');
  const body = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  if (!payments.verifyWebhook(body, signature)) return res.status(401).json({ error:{code:'INVALID_WEBHOOK_SIGNATURE'} });
  const event = payments.parseWebhook(req.body, { eventId: req.get('X-Payment-Event-Id') || req.get('X-Paytm-Event-Id') || undefined });
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
  if (err.code === 'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED') return res.status(503).json({ error: { code: err.code, message: 'Payment provider configuration is required.' } });
  if (err.code === 'PAYTM_ONBOARDING_REQUIRED') return res.status(503).json({ error: { code: err.code, message: 'Payment provider onboarding/integration is not enabled.' } });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
});

const port = Number(process.env.PORT) || 4000;
const httpServer=createServer(app);
const trackingRealtime=createTrackingRealtimeServer({httpServer,repository,authenticate:resolveTrackingUser});
if (process.env.NODE_ENV !== 'test') {
  httpServer.listen(port, () => console.log(`RideOn API listening on :${port}`));
}
export { app, repository, httpServer, trackingRealtime };
