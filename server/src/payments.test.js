import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPaymentService } from './payments.js';

function response(payload, status=200) {
  return {ok:status>=200&&status<300,status,text:async()=>JSON.stringify(payload)};
}

function fakeFetchFactory(routes) {
  const calls=[];
  const fetchImpl=async (url,options={})=>{
    calls.push({url,options});
    const route=routes.find(r=>r.match(url,options));
    if(!route) throw new Error('Unexpected provider request: '+url);
    return response(typeof route.body==='function'?route.body(url,options):route.body,route.status||200);
  };
  return {fetchImpl,calls};
}

function authService(overrides={}) {
  return createPaymentService({
    provider:'razorpay',
    keyId:'rzp_test_demo',
    keySecret:'test-secret-1234567890',
    webhookSecret:'webhook-secret',
    environment:'test',
    ...overrides,
  });
}

test('production rejects the mock provider', () => {
  assert.throws(() => createPaymentService({provider:'mock',environment:'production'}), error => error.code === 'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED');
});

test('Razorpay capability model does not invent individual UPI apps', () => {
  const service=authService();
  assert.equal(service.configured,true);
  assert.equal(service.capabilities.method,'upi');
  assert.equal(service.capabilities.supportsUpi,true);
  assert.equal(service.capabilities.supportsHostedCheckout,true);
  assert.equal(service.capabilities.supportsIntent,false);
  assert.equal(service.capabilities.supportsVpa,false);
  assert.deepEqual(service.capabilities.apps,[]);
});

test('create order uses server amount and persists provider-safe checkout data', async () => {
  const {fetchImpl,calls}=fakeFetchFactory([
    {match:url=>url.includes('/orders?'),body:{items:[]}},
    {match:(url,o)=>url.endsWith('/orders')&&o.method==='POST',body:{id:'order_123',amount:125000,currency:'INR',receipt:'rideon_booking_123',status:'created'}},
  ]);
  const service=authService({fetchImpl});
  const result=await service.createCustomerPayment({orderId:'booking-123',amountPaise:125000});
  assert.equal(result.providerOrderId,'order_123');
  assert.equal(result.amountPaise,125000);
  assert.equal(result.currency,'INR');
  assert.equal(result.checkout.keyId,'rzp_test_demo');
  assert.equal(result.checkout.orderId,'order_123');
  const body=JSON.parse(calls[1].options.body);
  assert.equal(body.amount,125000);
  assert.equal(body.currency,'INR');
});

test('verification rejects provider amount tampering', async () => {
  const {fetchImpl}=fakeFetchFactory([
    {match:url=>url.endsWith('/orders/order_123/payments'),body:{items:[{id:'pay_1',order_id:'order_123',amount:124999,currency:'INR',status:'captured'}]}},
  ]);
  const result=await authService({fetchImpl}).verifyPayment({providerOrderId:'order_123',providerPaymentId:'pay_1',amountPaise:125000});
  assert.equal(result.verified,false);
  assert.equal(result.status,'invalid');
});

test('verification authoritatively accepts an exact captured payment', async () => {
  const {fetchImpl}=fakeFetchFactory([
    {match:url=>url.endsWith('/orders/order_123/payments'),body:{items:[{id:'pay_1',order_id:'order_123',amount:125000,currency:'INR',status:'captured'}]}},
  ]);
  const result=await authService({fetchImpl}).verifyPayment({providerOrderId:'order_123',providerPaymentId:'pay_1',amountPaise:125000});
  assert.equal(result.verified,true);
  assert.equal(result.status,'paid');
  assert.equal(result.providerPaymentId,'pay_1');
  assert.equal(result.providerReference,'pay_1');
});

test('failed provider payment is never treated as success', async () => {
  const {fetchImpl}=fakeFetchFactory([
    {match:url=>url.endsWith('/orders/order_123/payments'),body:{items:[{id:'pay_1',order_id:'order_123',amount:125000,currency:'INR',status:'failed'}]}},
  ]);
  const result=await authService({fetchImpl}).verifyPayment({providerOrderId:'order_123',providerPaymentId:'pay_1',amountPaise:125000});
  assert.equal(result.verified,false);
  assert.equal(result.status,'failed');
});

test('checkout signature is timing-safe and rejects tampering', () => {
  const service=authService();
  const orderId='order_123', paymentId='pay_123';
  const signature=crypto.createHmac('sha256','test-secret-1234567890').update(orderId+'|'+paymentId).digest('hex');
  assert.equal(service.verifyCheckoutSignature({providerOrderId:orderId,providerPaymentId:paymentId,signature}),true);
  assert.equal(service.verifyCheckoutSignature({providerOrderId:orderId,providerPaymentId:paymentId,signature:signature.slice(0,-1)+'0'}),false);
});

test('webhook signature validation uses the raw body', () => {
  const service=authService();
  const body='{"event":"payment.captured","payload":{}}';
  const signature=crypto.createHmac('sha256','webhook-secret').update(body).digest('hex');
  assert.equal(service.verifyWebhook(body,signature),true);
  assert.equal(service.verifyWebhook(body,'invalid'),false);
});

test('payment webhook parser extracts provider payment and order references', () => {
  const service=authService();
  const event=service.parseWebhook({
    event:'payment.captured',
    payload:{payment:{entity:{id:'pay_123',order_id:'order_123',amount:125000,currency:'INR',status:'captured'}}},
  },{eventId:'evt_123'});
  assert.deepEqual(event,{
    eventId:'evt_123',
    providerPaymentId:'pay_123',
    providerReference:'pay_123',
    providerOrderId:'order_123',
    amountPaise:125000,
    currency:'INR',
    status:'paid',
  });
});

test('out-of-order failed webhook cannot downgrade a paid payment', () => {
  const service=authService();
  assert.equal(service.canTransition('paid','failed'),false);
  assert.equal(service.canTransition('pending','failed'),true);
});

test('refund is idempotent at the provider adapter boundary', async () => {
  let refunds=[];
  const {fetchImpl,calls}=fakeFetchFactory([
    {match:url=>url.endsWith('/orders/order_123/payments'),body:{items:[{id:'pay_1',order_id:'order_123',amount:125000,currency:'INR',status:'captured'}]}},
    {match:url=>url.includes('/payments/pay_1/refunds?'),body:()=>({items:refunds})},
    {match:(url,o)=>url.endsWith('/payments/pay_1/refund')&&o.method==='POST',body:()=>{const refund={id:'rfnd_1',amount:125000,status:'processed',notes:{rideon_refund_idempotency:'refund:payment-1'}};refunds.push(refund);return refund;}},
  ]);
  const service=authService({fetchImpl});
  const first=await service.refundPayment({providerOrderId:'order_123',amountPaise:125000,idempotencyKey:'refund:payment-1'});
  assert.equal(first.confirmed,true);
  assert.equal(first.providerReference,'rfnd_1');
  const second=await service.refundPayment({providerOrderId:'order_123',amountPaise:125000,idempotencyKey:'refund:payment-1'});
  assert.equal(second.confirmed,true);
  assert.equal(second.providerReference,'rfnd_1');
  assert.equal(calls.filter(c=>c.url.endsWith('/payments/pay_1/refund')).length,1);
});
