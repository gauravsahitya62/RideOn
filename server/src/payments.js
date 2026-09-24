import crypto from 'node:crypto';

const RENTAL_STATUSES = new Set(['pending','paid','held','settlement_pending','settled','refund_pending','refunded','failed','disputed']);
const PROVIDERS = new Set(['paytm','cashfree','razorpay','mock','unconfigured']);
const DEFAULT_UPI_APPS = [
  { id:'gpay', label:'Google Pay', packageName:'com.google.android.apps.nbu.paisa.user' },
  { id:'phonepe', label:'PhonePe', packageName:'com.phonepe.app' },
  { id:'paytm', label:'Paytm', packageName:'net.one97.paytm' },
];

function transition(current, next) {
  if (current === next) return true;
  const allowed = {
    pending:['paid','failed'],
    paid:['held','refund_pending','failed','disputed'],
    held:['settlement_pending','refund_pending','disputed'],
    settlement_pending:['settled','failed','disputed'],
    settled:['refund_pending','disputed'],
    refund_pending:['refunded','failed','disputed'],
    failed:['pending'],
    disputed:['refund_pending','settlement_pending'],
    refunded:[],
  };
  return Boolean(allowed[current]?.includes(next));
}

export function createPaymentService({
  provider = 'unconfigured',
  merchantId = '',
  clientId = '',
  clientSecret = '',
  website = '',
  callbackUrl = '',
  webhookSecret = '',
} = {}) {
  const selectedProvider = String(provider || 'unconfigured').toLowerCase();
  if (!PROVIDERS.has(selectedProvider)) {
    const error = new Error('Unsupported payment provider.');
    error.code = 'PAYMENT_PROVIDER_UNSUPPORTED';
    throw error;
  }
  const providerConfigured = Boolean((selectedProvider==='paytm' && merchantId && clientId && clientSecret && website && callbackUrl) || selectedProvider==='mock');
  const upiCapabilities = {
    method:'upi',
    apps:DEFAULT_UPI_APPS,
    supportsIntent:selectedProvider==='mock' ? true : false,
    supportsVpa:selectedProvider==='mock' ? true : false,
    provider:selectedProvider,
  };

  function verifyWebhook(body, signature) {
    if (!['paytm','mock'].includes(selectedProvider) || !webhookSecret || !signature) return false;
    const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    const given = String(signature).trim();
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    return a.length === b.length && crypto.timingSafeEqual(a,b);
  }

  function parseWebhook(payload = {}, { eventId: suppliedEventId } = {}) {
    const eventId = suppliedEventId || payload.eventId || payload.providerEventId || payload.referenceId;
    const providerReference = payload.providerReference || payload.transactionReference || payload.providerTransactionId || payload.paymentId;
    const providerOrderId = payload.providerOrderId || payload.orderId || payload.ORDERID;
    const bookingId = payload.bookingId ? String(payload.bookingId) : undefined;
    const paymentId = payload.paymentId ? String(payload.paymentId) : undefined;
    const status = String(payload.status || payload.STATUS || '').toLowerCase();
    const amountPaise = Number(payload.amountPaise ?? (payload.TXNAMOUNT != null ? Math.round(Number(payload.TXNAMOUNT) * 100) : NaN));
    if (!eventId || !providerReference || !providerOrderId || !RENTAL_STATUSES.has(status) || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || (payload.currency || 'INR') !== 'INR') return null;
    return { eventId:String(eventId), bookingId, paymentId, providerReference:String(providerReference), providerOrderId:String(providerOrderId), amountPaise, currency:'INR', status };
  }

  function canTransition(currentStatus, nextStatus) { return transition(currentStatus,nextStatus); }

  async function createCustomerPayment({ orderId, amountPaise } = {}) {
    if (!Number.isSafeInteger(Number(amountPaise)) || Number(amountPaise) <= 0) {
      const error = new Error('Invalid payment amount.'); error.code = 'PAYMENT_CREATION_FAILED'; throw error;
    }
    if (selectedProvider === 'mock') return { provider:'mock', status:'pending', providerOrderId:String(orderId), paymentUrl:`https://paytm.test/checkout/${encodeURIComponent(String(orderId))}`, amountPaise:Number(amountPaise), currency:'INR', upi:upiCapabilities };
    if (!providerConfigured) { const error = new Error('Payment provider is not configured.'); error.code='PAYMENT_NOT_CONFIGURED'; throw error; }
    if (selectedProvider !== 'mock') { const error = new Error('Configured provider does not yet expose a verified UPI checkout implementation.'); error.code='UPI_PROVIDER_INTEGRATION_REQUIRED'; throw error; }
    const error = new Error('Verified Paytm checkout integration is not configured for this merchant.'); error.code='PAYTM_ONBOARDING_REQUIRED'; throw error;
  }

  async function verifyPayment({ providerReference } = {}) { if (selectedProvider === 'mock') return { verified:true, providerReference:providerReference ? String(providerReference) : undefined }; const error=new Error('Verified Paytm payment-status integration is not configured for this merchant.'); error.code='PAYTM_ONBOARDING_REQUIRED'; throw error; }
  async function refundPayment({ paymentId, amountPaise, providerOrderId, idempotencyKey } = {}) { if (selectedProvider === 'mock') return { accepted:true, confirmed:false, providerReference:undefined, paymentId, amountPaise, providerOrderId, idempotencyKey }; const error=new Error('Verified refund integration is not configured for this provider.'); error.code='UPI_PROVIDER_INTEGRATION_REQUIRED'; throw error; }
  async function createVendorSettlement() { if (selectedProvider === 'mock') return { accepted:true, confirmed:false }; const error=new Error('Verified vendor settlement integration is not configured for this provider.'); error.code='UPI_PROVIDER_INTEGRATION_REQUIRED'; throw error; }
  async function getSettlementStatus() { if (selectedProvider === 'mock') return { status:'processing' }; const error=new Error('Verified settlement-status integration is not configured for this provider.'); error.code='UPI_PROVIDER_INTEGRATION_REQUIRED'; throw error; }
  async function reconcileTransaction() { if (selectedProvider === 'mock') return { reconciled:true }; const error=new Error('Verified transaction reconciliation integration is not configured for this provider.'); error.code='UPI_PROVIDER_INTEGRATION_REQUIRED'; throw error; }

  return { provider:selectedProvider, name:selectedProvider, configured:providerConfigured, capabilities:upiCapabilities, verifyWebhook, parseWebhook, canTransition, createCustomerPayment, verifyPayment, refundPayment, createVendorSettlement, getSettlementStatus, reconcileTransaction };
}
