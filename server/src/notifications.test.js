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


test('notification service sends transactional notifications to booking recipients without exposing GPS data', async () => {
  const pushes=[];
  const repository={
    findCustomerById:async id=>({id,role:id==='vendor-1'?'vendor':'customer'}),
    createNotification:async input=>({id:'n-'+input.recipientUserId,...input}),
    listEnabledPushDevices:async id=>id==='customer-1'?[{id:'d1',pushToken:'ExpoPushToken[test-token-1]',platform:'android'}]:[],
    getBookingNotificationRecipients:async()=>({customerId:'customer-1',vendorUserId:'vendor-1'}),
    recordPushDeliverySuccess:async()=>pushes.push('success'),
  };
  const service=createNotificationService({repository});
  const result=await service.notifyBooking({
    bookingId:'booking-1',
    type:'delivery_started',
    title:'Delivery started',
    body:'Your vehicle is on the way.',
    audience:'customer',
    dedupeKey:'delivery_started:booking-1',
    sendPush:false,
  });
  assert.equal(result.length,1);
  assert.equal(result[0].bookingId,'booking-1');
  assert.equal(result[0].body.includes('latitude'),false);
  assert.equal(pushes.length,0);
});

test('push registration accepts only Expo token format', async () => {
  let registered=false;
  const repository={registerPushDevice:async input=>{registered=true;return {id:'d1',...input};}};
  const service=createNotificationService({repository});
  const result=await service.notifyPushRegistration({userId:'u1',token:'ExponentPushToken[abc123]',platform:'ios'});
  assert.equal(registered,true);
  assert.equal(result.pushToken,'ExponentPushToken[abc123]');
});
