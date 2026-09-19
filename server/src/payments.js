import crypto from 'node:crypto';

export function createPaymentService({ provider = 'unconfigured', webhookSecret }) {
  const configured = Boolean(provider && provider !== 'unconfigured' && provider !== 'mock');
  function verifyWebhook(body, signature) {
    if (!configured || !webhookSecret || !signature) return false;
    const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    const given = String(signature);
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  function parseWebhook(payload) {
    if (!payload?.eventId || !payload?.bookingId) return null;
    if (!['pending', 'paid', 'failed', 'refunded'].includes(payload.status)) return null;
    return { eventId:String(payload.eventId), bookingId:String(payload.bookingId), status:String(payload.status), providerReference:payload.providerReference ? String(payload.providerReference) : undefined };
  }
  return { name: configured ? provider : 'unconfigured', verifyWebhook, parseWebhook };
}
