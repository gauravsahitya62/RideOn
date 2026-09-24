import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from './auth.js';
import { createPaymentService } from './payments.js';

test('signed JWT role is resolved from the authoritative identity store', async () => {
  const auth = createAuth({
    jwtSecret: 'test-secret',
    identityResolver: async id => ({ id, role: 'admin', accountStatus: 'active', fullName: 'Admin', email: 'admin@example.com' }),
  });
  const token = auth.sign({ sub:'user-1', role:'customer' });
  const req = { get: () => 'Bearer ' + token };
  const res = { status(code){ this.code=code; return this; }, json(body){ this.body=body; return this; } };
  let called = false;
  await auth.middleware()(req,res,()=>{ called=true; });
  assert.equal(called,true);
  assert.equal(req.user.role,'admin');
});

test('suspended customer sessions are blocked even with a valid signed token', async () => {
  const auth = createAuth({
    jwtSecret: 'test-secret',
    identityResolver: async id => ({ id, role:'customer', accountStatus:'suspended' }),
  });
  const token = auth.sign({ sub:'user-2', role:'customer' });
  const req = { get: () => 'Bearer ' + token };
  const res = { status(code){ this.code=code; return this; }, json(body){ this.body=body; return this; } };
  let called = false;
  await auth.middleware()(req,res,()=>{ called=true; });
  assert.equal(called,false);
  assert.equal(res.code,403);
  assert.equal(res.body.error.code,'ACCOUNT_SUSPENDED');
});

test('tampered JWTs are rejected', async () => {
  const auth = createAuth({ jwtSecret:'test-secret', identityResolver:async id=>({id,role:'admin',accountStatus:'active'}) });
  const req = { get: () => 'Bearer eyJhbGciOiJIUzI1NiJ9.invalid.signature' };
  const res = { status(code){ this.code=code; return this; }, json(body){ this.body=body; return this; } };
  let called = false;
  await auth.middleware()(req,res,()=>{ called=true; });
  assert.equal(called,false);
  assert.equal(res.code,401);
  assert.equal(res.body.error.code,'INVALID_TOKEN');
});

test('payment webhook verification is fail-closed without a secret', () => {
  const payments = createPaymentService({ provider:'paytm', merchantId:'m', clientId:'c', clientSecret:'s', website:'w', callbackUrl:'u' });
  assert.equal(payments.verifyWebhook('body','signature'),false);
});

test('payment webhook event validation rejects mismatched or unsafe values', () => {
  const payments = createPaymentService({ provider:'mock', webhookSecret:'secret' });
  assert.equal(payments.parseWebhook({ eventId:'evt', providerReference:'ref', providerOrderId:'order', status:'paid', amountPaise:0 }),null);
  assert.equal(payments.parseWebhook({ eventId:'evt', providerReference:'ref', providerOrderId:'order', status:'paid', amountPaise:100, currency:'USD' }),null);
  const valid=payments.parseWebhook({ eventId:'evt', providerReference:'ref', providerOrderId:'order', status:'paid', amountPaise:100, currency:'INR' });
  assert.deepEqual(valid,{eventId:'evt',bookingId:undefined,paymentId:undefined,providerReference:'ref',providerOrderId:'order',amountPaise:100,currency:'INR',status:'paid'});
});
