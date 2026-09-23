    delivery:false,address:'10 Payment Webhook Road, Jaipur'
  },login.accessToken,{'Idempotency-Key':`payment-booking-${Date.now()}`});
  assert.equal(created.status,201);
  const booking=(await created.json()).booking;
  const providerOrderId=`order-duplicate-${booking.bookingId}`;
  const payload={eventId:`evt-duplicate-${booking.bookingId}`,bookingId:booking.bookingId,status:'paid',providerReference:`pay-duplicate-${booking.bookingId}`,amountPaise:Math.round(booking.pricing.total*100),currency:'INR',providerOrderId};
  const configured=createPaymentService({provider:'razorpay',keyId:'k',keySecret:'s',webhookSecret:'webhook-secret'});
  const parsed=configured.parseWebhook(payload);
  assert.ok(parsed, 'Webhook payload must normalize before persistence.');
  const customerIdentity=await repository.findCustomerByPhone('+911234568001');
  await repository.createOrGetPaymentOrder({
    bookingId:booking.bookingId,
    customerId:customerIdentity.id,
    provider:'razorpay',
    amountPaise:parsed.amountPaise,
    currency:'INR',
    providerOrder:{id:parsed.providerOrderId,amountPaise:parsed.amountPaise,currency:'INR'}
  });
  const resolvedOrder = await repository.findPaymentByBooking(booking.bookingId);
  assert.equal(resolvedOrder?.providerOrderId, parsed.providerOrderId);
  const first=await repository.applyPaymentEvent(parsed);
  assert.equal(first.applied,true);
  const second=await repository.applyPaymentEvent(parsed);
  assert.equal(second.duplicate,true);
});

test('mock payment provider creates deterministic orders without network access', async () => {