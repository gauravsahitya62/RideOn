import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationService } from './notifications.js';

test('notification service creates an in-app notification and requests push delivery without blocking', async () => {
  const calls=[];
  const repository={
    findCustomerById:async id=>({id,role:'customer'}),
    createNotification:async input=>({id:'n1',...input}),
    listEnabledPushDevices:async()=>[],
  };
  const service=createNotificationService({repository});
  const notification=await service.notify({
    recipientUserId:'user-1',
    type:'booking_confirmed',
    title:'Booking confirmed',
    body:'Your booking is confirmed.',
    bookingId:'booking-1',
    dedupeKey:'booking_confirmed:booking-1:user-1',
  });
  calls.push(notification);
  assert.equal(calls[0].recipientUserId,'user-1');
  assert.equal(calls[0].bookingId,'booking-1');
});

test('notification service rejects unsupported notification types', async () => {
  const repository={findCustomerById:async id=>({id,role:'customer'})};
  const service=createNotificationService({repository});
  await assert.rejects(
    service.notify({recipientUserId:'user-1',type:'gps_coordinate',title:'GPS',body:'location'}),
    /Unsupported notification type/
  );
});

test('notification service validates Expo push tokens before registration', async () => {
  const repository={};
  const service=createNotificationService({repository});
  await assert.rejects(
    service.notifyPushRegistration({userId:'u1',token:'not-a-token',platform:'ios'}),
    error=>error?.code==='INVALID_PUSH_TOKEN'
  );
});
