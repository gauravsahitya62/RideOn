import crypto from 'node:crypto';

const VALID_STATUSES = new Set(['unpaid','pending','paid','failed','refunded']);
const TERMINAL_STATUS = new Set(['refunded']);
const PROVIDERS = new Set(['upi','mock','unconfigured']);

function paiseFromRupees(value) {
  const n = Number(value);
  return Number.isSafeInteger(Math.round(n * 100)) ? Math.round(n * 100) : null;
}

function stableUpiUri({ vpa, name, amountPaise, transactionRef, note }) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: name || 'RideOn',
    am: (Number(amountPaise) / 100).toFixed(2),
    cu: 'INR',
    tr: transactionRef,
    tn: note || 'RideOn vehicle rental',
  });
  return `upi://pay?${params.toString()}`;
}

export function createPaymentService({
  provider = 'unconfigured',
  merchantVpa = '',
  merchantName = 'RideOn',
  webhookSecret = '',
  fetchImpl = globalThis.fetch,
} = {}) {
  const selectedProvider = String(provider || 'unconfigured').toLowerCase();
  if (!PROVIDERS.has(selectedProvider)) {
    const error = new Error('Unsupported payment provider.');
    error.code = 'PAYMENT_PROVIDER_UNSUPPORTED';
    throw error;
  }

  const upiConfigured = selectedProvider === 'upi' && Boolean(merchantVpa && webhookSecret);
  const configured = selectedProvider !== 'unconfigured' && selectedProvider !== 'mock';

  function verifyWebhook(body, signature) {
    if (!['upi','mock'].includes(selectedProvider) || !webhookSecret || !signature) return false;
    const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    const given = String(signature).trim();
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(given, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function parseWebhook(payload = {}, { eventId: suppliedEventId } = {}) {
    const eventId = suppliedEventId || payload.eventId || payload.providerEventId;
    if (!eventId) return null;
    const bookingId = payload.bookingId ? String(payload.bookingId) : undefined;
    const paymentId = payload.paymentId ? String(payload.paymentId) : undefined;
    const providerReference = payload.providerReference || payload.transactionReference || payload.utr || payload.paymentId;
    const status = String(payload.status || '').toLowerCase();
    const amountPaise = Number(payload.amountPaise);
    if (!providerReference || !VALID_STATUSES.has(status) || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || payload.currency !== 'INR') return null;
    return {
      eventId: String(eventId),
      bookingId,
      paymentId,
      status,
      providerReference: String(providerReference),
      providerOrderId: payload.providerOrderId ? String(payload.providerOrderId) : undefined,
      amountPaise,
      currency: 'INR',
    };
  }

  function canTransition(currentStatus, nextStatus) {
    if (!VALID_STATUSES.has(nextStatus)) return false;
    if (currentStatus === nextStatus) return true;
    if (currentStatus === 'unpaid') return nextStatus === 'pending' || nextStatus === 'failed';
    if (currentStatus === 'pending') return nextStatus === 'paid' || nextStatus === 'failed';
    if (currentStatus === 'failed') return nextStatus === 'pending';
    if (currentStatus === 'paid') return nextStatus === 'refunded';
    return false;
  }

  async function createPaymentRequest({ paymentReference, amountPaise, currency='INR', note } = {}) {
    if (!Number.isSafeInteger(Number(amountPaise)) || Number(amountPaise) <= 0 || currency !== 'INR') {
      const error = new Error('Invalid payment amount or currency.');
      error.code = 'PAYMENT_CREATION_FAILED';
      throw error;
    }
    if (selectedProvider === 'mock') {
      return {
        id: `mock_payment_${String(paymentReference)}`,
        provider: 'mock',
        amountPaise: Number(amountPaise),
        currency: 'INR',
        status: 'pending',
        paymentReference: String(paymentReference),
        upiUri: stableUpiUri({ vpa: merchantVpa || 'rideon.test@upi', name: merchantName, amountPaise, transactionRef: String(paymentReference), note }),
      };
    }
    if (!upiConfigured) {
      const error = new Error('UPI payment provider is not configured.');
      error.code = 'PAYMENT_NOT_CONFIGURED';
      throw error;
    }
    const reference = String(paymentReference);
    return {
      id: reference,
      provider: 'upi',
      amountPaise: Number(amountPaise),
      currency: 'INR',
      status: 'pending',
      paymentReference: reference,
      upiVpa: merchantVpa,
      upiUri: stableUpiUri({ vpa: merchantVpa, name: merchantName, amountPaise, transactionRef: reference, note }),
    };
  }

  async function refundPayment() {
    const error = new Error('Refund requires the configured UPI provider reconciliation/refund mechanism.');
    error.code = 'REFUND_NOT_CONFIGURED';
    throw error;
  }

  return {
    name: configured ? selectedProvider : 'unconfigured',
    provider: selectedProvider,
    configured: selectedProvider === 'mock' || upiConfigured,
    verifyWebhook,
    parseWebhook,
    canTransition,
    createPaymentRequest,
    refundPayment,
    paiseFromRupees,
  };
}
