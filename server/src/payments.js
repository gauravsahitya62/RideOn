import crypto from 'node:crypto';

const VALID_STATUSES = new Set(['pending', 'paid', 'failed', 'refunded']);
const TERMINAL_STATUS = new Set(['refunded']);

export function createPaymentService({ provider = 'unconfigured', webhookSecret }) {
  const configured = Boolean(provider && provider !== 'unconfigured' && provider !== 'mock');

  function verifyWebhook(body, signature) {
    if (!configured || !webhookSecret || !signature) return false;
    const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    const given = String(signature).trim();
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(given, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function parseWebhook(payload) {
    if (!payload?.eventId || !payload?.bookingId || !payload?.providerReference) return null;
    if (!VALID_STATUSES.has(String(payload.status))) return null;
    const amountPaise = Number(payload.amountPaise);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 0 || payload.currency !== 'INR') return null;
    return {
      eventId: String(payload.eventId),
      bookingId: String(payload.bookingId),
      status: String(payload.status),
      providerReference: String(payload.providerReference),
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

  return { name: configured ? provider : 'unconfigured', verifyWebhook, parseWebhook, canTransition };
}
