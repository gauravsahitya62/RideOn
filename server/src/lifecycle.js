export const BOOKING_STATUSES = Object.freeze(['requested','confirmed','in_progress','completed','cancelled','rejected']);

export const BOOKING_TRANSITIONS = Object.freeze({
  requested: ['confirmed','rejected','cancelled'],
  confirmed: ['in_progress','cancelled'],
  in_progress: ['completed','cancelled'],
  rejected: [],
  completed: [],
  cancelled: [],
});

export function canTransitionBooking(current, next) {
  if (current === next) return true;
  return Boolean(BOOKING_TRANSITIONS[current]?.includes(next));
}

export function cancellationPolicy() {
  const cutoffHours = Math.max(0, Number(process.env.CANCELLATION_CUTOFF_HOURS ?? 24));
  const feePercent = Math.min(100, Math.max(0, Number(process.env.CANCELLATION_FEE_PERCENT ?? 0)));
  const refundPlatformFee = String(process.env.CANCELLATION_REFUND_PLATFORM_FEE ?? 'false').toLowerCase() === 'true';
  return { cutoffHours, feePercent, refundPlatformFee };
}

export function calculateCancellation({ booking, now = new Date() } = {}) {
  if (!booking) {
    const error = new Error('Booking not found.');
    error.code = 'BOOKING_NOT_FOUND';
    throw error;
  }
  if (!['requested','confirmed'].includes(String(booking.status))) {
    const error = new Error('This booking can no longer be cancelled.');
    error.code = 'CANCELLATION_NOT_ALLOWED';
    throw error;
  }
  const paid = ['paid','held','settlement_pending','settled','refund_pending'].includes(String(booking.paymentStatus));
  const pricing = booking.pricing || {};
  const rental = Math.max(0, Number(pricing.rental || 0));
  const delivery = Math.max(0, Number(pricing.deliveryFee || 0));
  const platform = Math.max(0, Number(pricing.platformFee || 0));
  const deposit = Math.max(0, Number(pricing.securityDeposit || 0));
  const hoursUntilPickup = (new Date(booking.startAt).getTime() - new Date(now).getTime()) / 3600000;
  const policy = cancellationPolicy();
  const withinCutoff = Number.isFinite(hoursUntilPickup) && hoursUntilPickup < policy.cutoffHours;
  const fee = paid && withinCutoff ? Math.round(rental * policy.feePercent) / 100 : 0;
  const refundableRental = paid ? Math.max(0, rental - fee) : 0;
  const refundableDelivery = paid ? delivery : 0;
  const refundablePlatform = paid && policy.refundPlatformFee ? platform : 0;
  const refundableDeposit = paid ? deposit : 0;
  const totalRefund = refundableRental + refundableDelivery + refundablePlatform + refundableDeposit;
  return {
    allowed: true,
    paid,
    hoursUntilPickup: Number.isFinite(hoursUntilPickup) ? Math.max(0, Math.round(hoursUntilPickup * 100) / 100) : null,
    policy,
    cancellationFee: fee,
    refundableRental,
    refundableDelivery,
    refundablePlatform,
    refundableSecurityDeposit: refundableDeposit,
    totalRefund,
    currency: 'INR',
  };
}
