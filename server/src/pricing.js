import { randomUUID } from 'node:crypto';

/**
 * Authoritative RideOn pricing rules.
 *
 * Existing product rules discovered in the repository:
 * - daily rental pricing
 * - minimum 1 day
 * - maximum 30 days
 * - 24h-per-rental-day billing via ceil(duration / 24h)
 * - no implemented tax/GST engine
 * - no implemented promotion/coupon engine
 *
 * Business decisions still required:
 * - hourly pricing
 * - tax/GST rate
 * - promotion/coupon rules
 *
 * Until those are configured, they remain zero and are not invented.
 */

export function createPricingService(env = process.env) {
  const toMoney = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const toPercent = (value, fallback = 5) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
  };

  const config = Object.freeze({
    minimumDays: Math.max(1, Number(env.RENTAL_MIN_DAYS ?? 1) || 1),
    maximumDays: Math.max(
      Number(env.RENTAL_MIN_DAYS ?? 1) || 1,
      Number(env.RENTAL_MAX_DAYS ?? 30) || 30
    ),
    deliveryFee: toMoney(env.RIDEON_DELIVERY_FEE ?? 199),
    platformFeePercent: toPercent(env.RIDEON_PLATFORM_FEE_PERCENT ?? 5, 5),
    taxPercent: toPercent(env.RIDEON_TAX_PERCENT ?? 0, 0),
    quoteTtlSeconds: Math.max(60, Number(env.RIDEON_QUOTE_TTL_SECONDS ?? 300) || 300),
    reservationTtlSeconds: Math.max(60, Number(env.RIDEON_RESERVATION_TTL_SECONDS ?? 600) || 600),
  });

  function parseWindow(startAt, endAt, now = new Date()) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      const error = new Error('Pickup and return times must form a valid rental window.');
      error.code = 'INVALID_BOOKING_WINDOW';
      throw error;
    }
    const durationMs = end.getTime() - start.getTime();
    const days = Math.ceil(durationMs / 86400000);
    if (days < config.minimumDays || days > config.maximumDays) {
      const error = new Error(
        `Rental duration must be between ${config.minimumDays} and ${config.maximumDays} day(s).`
      );
      error.code = 'INVALID_BOOKING_WINDOW';
      throw error;
    }
    if (start.getTime() < now.getTime()) {
      const error = new Error('Pickup time must be in the future.');
      error.code = 'INVALID_BOOKING_WINDOW';
      throw error;
    }
    return { start, end, days };
  }

  function calculateVehicle({ vehicle, startAt, endAt, delivery = false, discount = 0 }) {
    if (!vehicle) {
      const error = new Error('Vehicle not found.');
      error.code = 'VEHICLE_NOT_FOUND';
      throw error;
    }

    const { start, end, days } = parseWindow(startAt, endAt);
    const dailyRate = toMoney(vehicle.pricePerDay ?? vehicle.dailyRate);
    const securityDeposit = toMoney(vehicle.securityDeposit);
    const rentalSubtotal = Math.round(dailyRate * days * 100) / 100;
    const deliveryFee = delivery ? config.deliveryFee : 0;
    const platformFee = Math.round(rentalSubtotal * config.platformFeePercent) / 100;
    const allowedDiscount = Math.min(
      rentalSubtotal + deliveryFee + platformFee,
      toMoney(discount)
    );
    const taxableBase = Math.max(0, rentalSubtotal + deliveryFee + platformFee - allowedDiscount);
    const tax = Math.round(taxableBase * config.taxPercent) / 100;
    const payableExcludingDeposit = Math.max(0, taxableBase + tax);
    const total = payableExcludingDeposit + securityDeposit;

    return {
      vehicleId: String(vehicle.id),
      vehicleName: vehicle.name,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      days,
      hourlyPricingSupported: false,
      unitPrice: dailyRate,
      unit: 'day',
      rentalSubtotal,
      deliveryFee,
      platformFee,
      tax,
      discount: allowedDiscount,
      securityDeposit,
      totalPayable: total,
      refundableSecurityDeposit: securityDeposit,
      payableExcludingDeposit,
      currency: 'INR',
    };
  }

  function calculateMultiVehicle({ vehicles, startAt, endAt, delivery = false, discount = 0 }) {
    const items = (vehicles || []).map((vehicle) =>
      calculateVehicle({ vehicle, startAt, endAt, delivery, discount: 0 })
    );
    const rentalSubtotal = items.reduce((sum, item) => sum + item.rentalSubtotal, 0);
    const deliveryFee = items.reduce((sum, item) => sum + item.deliveryFee, 0);
    const platformFee = items.reduce((sum, item) => sum + item.platformFee, 0);
    const securityDeposit = items.reduce((sum, item) => sum + item.securityDeposit, 0);
    const requestedDiscount = Math.max(0, Math.round(Number(discount || 0) * 100) / 100);
    const cappedDiscount = Math.min(rentalSubtotal + deliveryFee + platformFee, requestedDiscount);
    const taxableBase = Math.max(0, rentalSubtotal + deliveryFee + platformFee - cappedDiscount);
    const tax = Math.round(taxableBase * config.taxPercent) / 100;
    const payableExcludingDeposit = Math.max(0, taxableBase + tax);
    const totalPayable = payableExcludingDeposit + securityDeposit;

    return {
      items,
      rentalSubtotal,
      deliveryFee,
      platformFee,
      tax,
      discount: cappedDiscount,
      securityDeposit,
      payableExcludingDeposit,
      totalPayable,
      refundableSecurityDeposit: securityDeposit,
      currency: 'INR',
      quoteExpiresAt: new Date(Date.now() + config.quoteTtlSeconds * 1000).toISOString(),
      pricingConfigVersion: 'v1',
    };
  }

  function calculateCancellation({ booking, now = new Date() }) {
    const original = {
      rentalSubtotal: toMoney(booking?.pricing?.rental),
      deliveryFee: toMoney(booking?.pricing?.deliveryFee),
      platformFee: toMoney(booking?.pricing?.platformFee),
      tax: toMoney(booking?.pricing?.tax),
      discount: toMoney(booking?.pricing?.discount),
      securityDeposit: toMoney(booking?.pricing?.securityDeposit),
    };
    return {
      ...original,
      pricingSnapshot: true,
      calculatedAt: now.toISOString(),
    };
  }

  function reservationExpiry() {
    return new Date(Date.now() + config.reservationTtlSeconds * 1000).toISOString();
  }

  return Object.freeze({
    config,
    parseWindow,
    calculateVehicle,
    calculateMultiVehicle,
    calculateCancellation,
    reservationExpiry,
    createReservationId: () => randomUUID(),
  });
}
