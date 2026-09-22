import crypto from 'node:crypto';

const VALID_STATUSES = new Set(['unpaid', 'pending', 'paid', 'failed', 'refunded']);
const TERMINAL_STATUS = new Set(['refunded']);
const PROVIDERS = new Set(['razorpay', 'mock', 'unconfigured']);

function paiseFromRupees(value) {
  const n = Number(value);
  return Number.isSafeInteger(Math.round(n * 100)) ? Math.round(n * 100) : null;
}

export function createPaymentService({
  provider = 'unconfigured',
  keyId = '',
  keySecret = '',
  webhookSecret = '',
  fetchImpl = globalThis.fetch,
} = {}) {
  const selectedProvider = String(provider || 'unconfigured').toLowerCase();
  if (!PROVIDERS.has(selectedProvider)) {
    const error = new Error('Unsupported payment provider.');
    error.code = 'PAYMENT_PROVIDER_UNSUPPORTED';
    throw error;
  }

  const configured = selectedProvider !== 'unconfigured' && selectedProvider !== 'mock';
  const razorpayConfigured = selectedProvider === 'razorpay' && Boolean(keyId && keySecret && webhookSecret);

  function verifyWebhook(body, signature) {
    if (!configured || !webhookSecret || !signature) return false;
    const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    const given = String(signature).trim();
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(given, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function verifyCheckoutSignature({ orderId, paymentId, signature }) {
    if (selectedProvider !== 'razorpay' || !keySecret || !orderId || !paymentId || !signature) return false;
    const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature).trim(), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function parseWebhook(payload = {}) {
    const eventId = payload.eventId || payload.providerEventId;
    const bookingId = payload.bookingId;
    const providerReference = payload.providerReference || payload.paymentId || payload.orderId;
    if (!eventId || !bookingId || !providerReference) return null;
    if (!VALID_STATUSES.has(String(payload.status))) return null;
    const amountPaise = Number(payload.amountPaise);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 0 || payload.currency !== 'INR') return null;
    return {
      eventId: String(eventId),
      bookingId: String(bookingId),
      status: String(payload.status),
      providerReference: String(providerReference),
      providerOrderId: payload.providerOrderId ? String(payload.providerOrderId) : undefined,
      amountPaise,
      currency: 'INR',
    };
  }

  function canTransition(currentStatus, nextStatus) {
    if (!VALID_STATUSES.has(nextStatus)) return false;
    if (currentStatus === nextStatus) return true;
    if (TERMINAL_STATUS.has(currentStatus)) return false;
    if (currentStatus === 'unpaid') return nextStatus === 'pending' || nextStatus === 'failed';
    if (currentStatus === 'pending') return nextStatus === 'paid' || nextStatus === 'failed';
    if (currentStatus === 'failed') return nextStatus === 'pending';
    if (currentStatus === 'paid') return nextStatus === 'refunded';
    return false;
  }

  async function createOrder({ receipt, amountPaise, currency = 'INR', notes = {} } = {}) {
    if (!razorpayConfigured) {
      const error = new Error('Payment provider is not configured.');
      error.code = 'PAYMENT_NOT_CONFIGURED';
      throw error;
    }
    if (!Number.isSafeInteger(Number(amountPaise)) || Number(amountPaise) <= 0 || currency !== 'INR') {
      const error = new Error('Invalid payment amount or currency.');
      error.code = 'PAYMENT_CREATION_FAILED';
      throw error;
    }

    const authorization = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    let response;
    try {
      response = await fetchImpl('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authorization}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: Number(amountPaise),
          currency: 'INR',
          receipt: String(receipt),
          notes,
        }),
      });
    } catch {
      const error = new Error('Unable to reach the payment provider.');
      error.code = 'PAYMENT_CREATION_FAILED';
      throw error;
    }
    if (!response?.ok) {
      const error = new Error('Payment order creation failed.');
      error.code = 'PAYMENT_CREATION_FAILED';
      throw error;
    }
    const payload = await response.json();
    if (!payload?.id || Number(payload.amount) !== Number(amountPaise) || payload.currency !== 'INR') {
      const error = new Error('Payment provider returned an invalid order.');
      error.code = 'PAYMENT_CREATION_FAILED';
      throw error;
    }
    return {
      id: String(payload.id),
      amountPaise: Number(payload.amount),
      currency: 'INR',
      status: String(payload.status || 'created'),
      provider: 'razorpay',
    };
  }

  async function refundPayment({ paymentId, amountPaise } = {}) {
    if (!razorpayConfigured) {
      const error = new Error('Payment provider is not configured.');
      error.code = 'PAYMENT_NOT_CONFIGURED';
      throw error;
    }
    if (!paymentId) {
      const error = new Error('Provider payment reference is required.');
      error.code = 'REFUND_FAILED';
      throw error;
    }
    const authorization = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const body = Number.isSafeInteger(Number(amountPaise)) && Number(amountPaise) > 0
      ? JSON.stringify({ amount: Number(amountPaise) })
      : '{}';
    let response;
    try {
      response = await fetchImpl(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authorization}`,
          'Content-Type': 'application/json',
        },
        body,
      });
    } catch {
      const error = new Error('Unable to reach the payment provider.');
      error.code = 'REFUND_FAILED';
      throw error;
    }
    if (!response?.ok) {
      const error = new Error('Provider refund failed.');
      error.code = 'REFUND_FAILED';
      throw error;
    }
    const payload = await response.json();
    if (!payload?.id) {
      const error = new Error('Provider returned an invalid refund.');
      error.code = 'REFUND_FAILED';
      throw error;
    }
    return { id: String(payload.id), providerReference: String(payload.payment_id || paymentId) };
  }

  return {
    name: configured ? selectedProvider : 'unconfigured',
    provider: selectedProvider,
    configured: razorpayConfigured,
    verifyWebhook,
    verifyCheckoutSignature,
    parseWebhook,
    canTransition,
    createOrder,
    refundPayment,
    paiseFromRupees,
  };
}
