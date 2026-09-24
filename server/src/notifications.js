import { setTimeout as delay } from 'node:timers/promises';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_PATTERN = /^(?:ExpoPushToken|ExponentPushToken)\[[^\]]+\]$/;
const BATCH_SIZE = 100;

const TRANSACTIONAL_TYPES = new Set([
  'booking_created','booking_confirmed','booking_rejected','booking_cancelled',
  'payment_success','payment_failed','refund_initiated','refund_completed',
  'security_deposit_held','security_deposit_released','delivery_assigned',
  'delivery_started','vehicle_in_delivery','vehicle_delivered','booking_completed',
  'review_reminder','support_reply','new_booking','booking_cancelled','payment_received',
  'delivery_required','delivery_started','vehicle_returned','customer_review',
  'new_support_ticket','payment_issue','refund_issue','delivery_issue','dispute_created',
]);

function safeId(value) {
  return value == null ? null : String(value);
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function buildPushData(notification) {
  return {
    type: notification.type,
    ...(notification.bookingId ? { bookingId: notification.bookingId } : {}),
    ...(notification.ticketId ? { ticketId: notification.ticketId } : {}),
  };
}

async function postExpoPush(messages) {
  if (!messages.length) return [];
  const accessToken = String(process.env.EXPO_ACCESS_TOKEN || '').trim();
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Expo push request failed with status ${response.status}`);
    return Array.isArray(payload?.data) ? payload.data : [];
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'push_delivery_failed',
      message: error?.message || 'Push delivery request failed',
      count: messages.length,
    }));
    return [];
  }
}

export function createNotificationService({ repository }) {
  async function sendPushForNotification(notification) {
    try {
      const devices = await repository.listEnabledPushDevices(notification.recipientUserId);
      if (!devices.length) return { sent: 0, invalid: 0 };
      let sent = 0;
      let invalid = 0;
      for (let offset = 0; offset < devices.length; offset += BATCH_SIZE) {
        const batch = devices.slice(offset, offset + BATCH_SIZE);
        const messages = batch.map(device => ({
          to: device.pushToken,
          sound: 'default',
          title: notification.title,
          body: notification.body,
          data: buildPushData(notification),
          priority: 'high',
          channelId: 'rideon-transactional',
        }));
        const receipts = await postExpoPush(messages);
        for (let i = 0; i < receipts.length; i += 1) {
          const receipt = receipts[i];
          const device = batch[i];
          if (!device) continue;
          const errorCode = receipt?.status === 'error' ? receipt?.details?.error : null;
          if (errorCode === 'DeviceNotRegistered' || errorCode === 'InvalidCredentials') {
            invalid += 1;
            await repository.disablePushDevice(device.id).catch(() => {});
          } else if (receipt?.status === 'ok') {
            sent += 1;
            await repository.recordPushDeliverySuccess(device.id).catch(() => {});
          } else if (receipt?.status === 'error') {
            await repository.recordPushDeliveryFailure(device.id).catch(() => {});
          }
        }
        if (offset + BATCH_SIZE < devices.length) await delay(10);
      }
      return { sent, invalid };
    } catch (error) {
      console.warn(JSON.stringify({ level:'warn', event:'push_delivery_failed', message:error?.message || 'Push delivery failed' }));
      return { sent:0, invalid:0 };
    }
  }

  async function notify({
    recipientUserId,
    type,
    title,
    body,
    bookingId = null,
    ticketId = null,
    dedupeKey = null,
    sendPush = true,
  }) {
    if (!TRANSACTIONAL_TYPES.has(type)) throw new Error(`Unsupported notification type: ${type}`);
    const recipient = await repository.findCustomerById(recipientUserId);
    if (!recipient?.id || !['customer','vendor','support','admin'].includes(recipient.role)) return null;

    const notification = await repository.createNotification({
      recipientUserId: recipient.id,
      type,
      title: cleanText(title, 160),
      body: cleanText(body, 1000),
      bookingId: safeId(bookingId),
      ticketId: safeId(ticketId),
      dedupeKey: dedupeKey ? cleanText(dedupeKey, 180) : null,
    });
    if (!notification) return null;
    if (sendPush) void sendPushForNotification(notification);
    return notification;
  }

  async function notifyBooking({ bookingId, type, title, body, audience = 'customer', dedupeKey, sendPush = true }) {
    const recipients = await repository.getBookingNotificationRecipients(bookingId);
    const ids = audience === 'customer'
      ? [recipients.customerId]
      : audience === 'vendor'
        ? [recipients.vendorUserId]
        : [recipients.customerId, recipients.vendorUserId];
    const unique = [...new Set(ids.filter(Boolean).map(String))];
    const results = await Promise.all(unique.map((recipientUserId) => notify({
      recipientUserId,
      type,
      title,
      body,
      bookingId,
      dedupeKey: dedupeKey ? `${dedupeKey}:${recipientUserId}` : null,
      sendPush,
    })));
    return results.filter(Boolean);
  }

  async function notifySupport({ type, title, body, ticketId = null, bookingId = null, dedupeKey }) {
    const recipients = await repository.listSupportUserIds();
    const results = await Promise.all(recipients.map((recipientUserId) => notify({
      recipientUserId,
      type,
      title,
      body,
      ticketId,
      bookingId,
      dedupeKey: dedupeKey ? `${dedupeKey}:${recipientUserId}` : null,
    })));
    return results.filter(Boolean);
  }

  async function notifyPushRegistration({ userId, token, platform, deviceId }) {
    if (!EXPO_TOKEN_PATTERN.test(String(token || '').trim())) {
      const error = new Error('Invalid Expo push token.');
      error.code = 'INVALID_PUSH_TOKEN';
      throw error;
    }
    return repository.registerPushDevice({
      userId,
      pushToken: String(token).trim(),
      platform,
      deviceId: deviceId ? String(deviceId).slice(0, 255) : null,
    });
  }

  return {
    notify,
    notifyBooking,
    notifySupport,
    notifyPushRegistration,
    sendPushForNotification,
  };
}
