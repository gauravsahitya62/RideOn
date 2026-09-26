import crypto from 'node:crypto';

const RENTAL_STATUSES = new Set(['pending','paid','held','settlement_pending','settled','refund_pending','refunded','failed','disputed']);
const PROVIDERS = new Set(['razorpay','mock','unconfigured']);
const DEFAULT_API_BASE = 'https://api.razorpay.com/v1';

function transition(current, next) {
  if (current === next) return true;
  const allowed = {
    pending:['paid','failed'],
    paid:['held','refund_pending','disputed'],
    held:['settlement_pending','refund_pending','disputed'],
    settlement_pending:['settled','disputed'],
    settled:['refund_pending','disputed'],
    refund_pending:['refunded','disputed'],
    failed:['pending'],
    disputed:['refund_pending','settlement_pending'],
    refunded:[],
  };
  return Boolean(allowed[current]?.includes(next));
}

function errorWithCode(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function safeEqualHex(left, right) {
  const a = Buffer.from(String(left || '').trim(), 'utf8');
  const b = Buffer.from(String(right || '').trim(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function stableJson(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function checksumString(params = {}) {
  return Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null)
    .sort()
    .map(key => stableJson(params[key]))
    .join('|');
}

function razorpayCheckoutSignature(orderId, paymentId, secret) {
  return crypto.createHmac('sha256', secret).update(String(orderId) + '|' + String(paymentId)).digest('hex');
}

function validateAmount(amountPaise) {
  const value = Number(amountPaise);
  if (!Number.isSafeInteger(value) || value <= 0) throw errorWithCode('Invalid payment amount.', 'PAYMENT_CREATION_FAILED');
  return value;
}

async function requestJson(fetchImpl, url, options = {}, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {...options, signal:controller.signal});
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {
      payload = null;
    }
    if (!response.ok) {
      const providerMessage = payload?.error?.description || payload?.error?.message || payload?.message || 'Payment provider request failed.';
      throw errorWithCode(providerMessage, 'PAYMENT_PROVIDER_REQUEST_FAILED', {httpStatus:response.status, providerPayload:payload});
    }
    return payload || {};
  } catch (error) {
    if (error?.name === 'AbortError') throw errorWithCode('Payment provider request timed out.', 'PAYMENT_PROVIDER_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function resultStatus(payload) {
  return String(
    payload?.status ||
    payload?.resultInfo?.resultStatus ||
    payload?.body?.resultInfo?.resultStatus ||
    ''
  ).toUpperCase();
}

export function createPaymentService({
  provider = 'unconfigured',
  keyId = '',
  keySecret = '',
  webhookSecret = '',
  environment = 'test',
  apiBaseUrl = DEFAULT_API_BASE,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  const selectedProvider = String(provider || 'unconfigured').toLowerCase();
  if (!PROVIDERS.has(selectedProvider)) throw errorWithCode('Unsupported payment provider.', 'PAYMENT_PROVIDER_UNSUPPORTED');

  const razorpayConfigured = selectedProvider === 'razorpay' && Boolean(keyId && keySecret && webhookSecret);
  const isProduction = String(environment).toLowerCase() === 'production';
  if (selectedProvider === 'mock' && isProduction) throw errorWithCode('Mock payment provider is not allowed in production.', 'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED');

  if (selectedProvider === 'razorpay' && isProduction && String(keyId).startsWith('rzp_test_')) {
    throw errorWithCode('A Razorpay test key cannot be used in production.', 'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED');
  }
  if (selectedProvider === 'razorpay' && !isProduction && String(keyId).startsWith('rzp_live_')) {
    throw errorWithCode('A Razorpay live key cannot be used in the test environment.', 'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED');
  }

  const capabilities = selectedProvider === 'razorpay'
    ? {
        method:'upi',
        provider:'razorpay',
        supportsUpi:true,
        supportsHostedCheckout:true,
        supportsIntent:false,
        supportsVpa:false,
        apps:[],
      }
    : selectedProvider === 'mock'
      ? {
          method:'upi',
          provider:'mock',
          supportsUpi:false,
          supportsHostedCheckout:false,
          supportsIntent:false,
          supportsVpa:false,
          apps:[],
        }
      : {
          method:'upi',
          provider:selectedProvider,
          supportsUpi:false,
          supportsHostedCheckout:false,
          supportsIntent:false,
          supportsVpa:false,
          apps:[],
        };

  const authHeader = selectedProvider === 'razorpay'
    ? 'Basic ' + Buffer.from(String(keyId) + ':' + String(keySecret)).toString('base64')
    : '';

  async function razorpayRequest(path, options = {}) {
    if (!razorpayConfigured) throw errorWithCode('Razorpay payment provider is not configured.', 'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED');
    return requestJson(fetchImpl, apiBaseUrl.replace(/\/$/, '') + path, {
      ...options,
      headers:{
        Accept:'application/json',
        'Content-Type':'application/json',
        Authorization:authHeader,
        ...(options.headers || {}),
      },
    }, {timeoutMs});
  }

  async function findExistingOrder(receipt, amountPaise) {
    const response = await razorpayRequest('/orders?count=10&receipt=' + encodeURIComponent(receipt), {method:'GET'});
    const orders = Array.isArray(response?.items) ? response.items : [];
    const match = orders.find(order =>
      String(order.receipt || '') === String(receipt) &&
      Number(order.amount) === Number(amountPaise) &&
      String(order.currency || '') === 'INR' &&
      ['created','attempted','paid'].includes(String(order.status || '').toLowerCase())
    );
    return match || null;
  }

  async function createCustomerPayment({ orderId, amountPaise } = {}) {
    const amount = validateAmount(amountPaise);
    if (selectedProvider === 'mock') return {
      provider:'mock', status:'pending', providerOrderId:String(orderId),
      paymentUrl:null, amountPaise:amount, currency:'INR', upi:capabilities,
    };
    if (!razorpayConfigured) throw errorWithCode('Razorpay payment provider is not configured.', 'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED');

    const receipt = ('rideon_' + String(orderId).replace(/[^A-Za-z0-9_-]/g, '')).slice(-40);
    let order = await findExistingOrder(receipt, amount).catch(error => {
      if (error?.httpStatus === 404) return null;
      throw error;
    });

    if (!order) {
      order = await razorpayRequest('/orders', {
        method:'POST',
        body:JSON.stringify({
          amount,
          currency:'INR',
          receipt,
          notes:{rideon_order_id:String(orderId)},
        }),
      });
    }

    if (!order?.id || Number(order.amount) !== amount || String(order.currency) !== 'INR') {
      throw errorWithCode('Razorpay returned an invalid payment order.', 'PAYMENT_CREATION_FAILED');
    }

    return {
      provider:'razorpay',
      status:'pending',
      providerOrderId:String(order.id),
      amountPaise:Number(order.amount),
      currency:'INR',
      checkout:{keyId:String(keyId),orderId:String(order.id),amountPaise:Number(order.amount),currency:'INR'},
      upi:capabilities,
    };
  }

  async function listOrderPayments(providerOrderId) {
    if (!providerOrderId) throw errorWithCode('Provider order ID is required.', 'PAYMENT_VERIFICATION_FAILED');
    const response = await razorpayRequest('/orders/' + encodeURIComponent(String(providerOrderId)) + '/payments', {method:'GET'});
    return Array.isArray(response?.items) ? response.items : [];
  }

  async function verifyPayment({ providerPaymentId, providerOrderId, providerReference, amountPaise } = {}) {
    if (selectedProvider === 'mock') return {verified:false};
    if (!razorpayConfigured) throw errorWithCode('Razorpay payment provider is not configured.', 'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED');

    const expectedAmount = validateAmount(amountPaise);
    const payments = await listOrderPayments(providerOrderId);
    const candidateId = providerPaymentId || providerReference;
    let providerPayment = candidateId
      ? payments.find(payment => String(payment.id) === String(candidateId))
      : null;
    if (!providerPayment) {
      providerPayment = payments.find(payment =>
        String(payment.order_id || '') === String(providerOrderId) &&
        Number(payment.amount) === expectedAmount &&
        String(payment.currency || '') === 'INR' &&
        ['captured','authorized'].includes(String(payment.status || '').toLowerCase())
      );
    }
    if (!providerPayment) return {verified:false, status:'pending'};

    const status = String(providerPayment.status || '').toLowerCase();
    const validAmount = Number(providerPayment.amount) === expectedAmount;
    const validCurrency = String(providerPayment.currency || '') === 'INR';
    const validOrder = String(providerPayment.order_id || '') === String(providerOrderId);
    if (!validAmount || !validCurrency || !validOrder) return {verified:false, status:'invalid'};

    if (status === 'captured') {
      return {
        verified:true,
        status:'paid',
        providerPaymentId:String(providerPayment.id),
        providerReference:String(providerPayment.id),
        providerOrderId:String(providerPayment.order_id),
        amountPaise:Number(providerPayment.amount),
        currency:'INR',
      };
    }
    if (status === 'failed') {
      return {
        verified:false,
        status:'failed',
        providerPaymentId:String(providerPayment.id),
        providerReference:String(providerPayment.id),
        providerOrderId:String(providerPayment.order_id),
        amountPaise:Number(providerPayment.amount),
        currency:'INR',
      };
    }
    return {verified:false,status:'pending',providerPaymentId:String(providerPayment.id)};
  }

  async function refundPayment({ amountPaise, providerOrderId, idempotencyKey } = {}) {
    if (selectedProvider === 'mock') return {accepted:true,confirmed:false};
    if (!razorpayConfigured) throw errorWithCode('Razorpay payment provider is not configured.', 'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED');
    const amount = validateAmount(amountPaise);
    const payments = await listOrderPayments(providerOrderId);
    const captured = payments.find(payment =>
      String(payment.order_id || '') === String(providerOrderId) &&
      Number(payment.amount) >= amount &&
      String(payment.currency || '') === 'INR' &&
      String(payment.status || '').toLowerCase() === 'captured'
    );
    if (!captured?.id) throw errorWithCode('The original Razorpay payment could not be located for refund.', 'REFUND_PROVIDER_PAYMENT_NOT_FOUND');

    const refundList = await razorpayRequest('/payments/' + encodeURIComponent(String(captured.id)) + '/refunds?count=100', {method:'GET'});
    const existing = (Array.isArray(refundList?.items) ? refundList.items : []).find(refund =>
      String(refund.notes?.rideon_refund_idempotency || '') === String(idempotencyKey || '') ||
      (Number(refund.amount) === amount && ['processed','pending'].includes(String(refund.status || '').toLowerCase()))
    );
    if (existing) {
      return {
        accepted:true,
        confirmed:String(existing.status || '').toLowerCase() === 'processed',
        providerReference:String(existing.id),
        providerRefundId:String(existing.id),
      };
    }

    const refund = await razorpayRequest('/payments/' + encodeURIComponent(String(captured.id)) + '/refund', {
      method:'POST',
      body:JSON.stringify({
        amount,
        notes:{rideon_refund_idempotency:String(idempotencyKey || '')},
      }),
    });
    if (!refund?.id) throw errorWithCode('Razorpay did not return a refund reference.', 'REFUND_PROVIDER_FAILED');
    const refundStatus = String(refund.status || '').toLowerCase();
    if (!['processed','pending'].includes(refundStatus)) throw errorWithCode('Razorpay reported a failed refund.', 'REFUND_PROVIDER_FAILED');
    return {
      accepted:true,
      confirmed:refundStatus === 'processed',
      providerReference:String(refund.id),
      providerRefundId:String(refund.id),
    };
  }

  function verifyWebhook(body, signature) {
    if(selectedProvider==='mock'){
      if(!webhookSecret||!signature)return false;
      const expected=crypto.createHmac('sha256',webhookSecret).update(body).digest('hex');
      return safeEqualHex(expected,signature);
    }
    if(selectedProvider !== 'razorpay' || !razorpayConfigured || !signature) return false;
    const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    return safeEqualHex(expected, signature);
  }

  function getCheckoutConfig({providerOrderId, amountPaise, callbackUrl} = {}) {
    if (selectedProvider !== 'razorpay' || !razorpayConfigured) throw errorWithCode('Razorpay payment provider is not configured.', 'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED');
    const amount = validateAmount(amountPaise);
    return {provider:'razorpay',keyId:String(keyId),orderId:String(providerOrderId),amountPaise:amount,currency:'INR',callbackUrl:String(callbackUrl || '')};
  }

  function verifyCheckoutSignature({providerOrderId, providerPaymentId, signature} = {}) {
    if (selectedProvider !== 'razorpay' || !razorpayConfigured || !providerOrderId || !providerPaymentId || !signature) return false;
    const expected = razorpayCheckoutSignature(providerOrderId, providerPaymentId, keySecret);
    return safeEqualHex(expected, signature);
  }

  function parseWebhook(payload = {}, {eventId: suppliedEventId, eventName: suppliedEventName} = {}) {
    if(selectedProvider==='mock'){
      const eventId=suppliedEventId||payload.eventId||payload.providerEventId||payload.referenceId;
      const providerReference=payload.providerReference||payload.transactionReference||payload.providerTransactionId||payload.paymentId;
      const providerOrderId=payload.providerOrderId||payload.orderId||payload.ORDERID;
      const status=String(payload.status||payload.STATUS||'').toLowerCase();
      const amountPaise=Number(payload.amountPaise ?? (payload.TXNAMOUNT!=null?Math.round(Number(payload.TXNAMOUNT)*100):NaN));
      if(!eventId||!providerReference||!providerOrderId||!RENTAL_STATUSES.has(status)||!Number.isSafeInteger(amountPaise)||amountPaise<=0||(payload.currency||'INR')!=='INR')return null;
      return {eventId:String(eventId),bookingId:payload.bookingId?String(payload.bookingId):undefined,paymentId:payload.paymentId?String(payload.paymentId):undefined,providerPaymentId:String(providerReference),providerReference:String(providerReference),providerOrderId:String(providerOrderId),amountPaise,currency:'INR',status};
    }
    if (selectedProvider !== 'razorpay') return null;
    const eventId = suppliedEventId || payload.eventId || payload.id;
    const eventName = String(suppliedEventName || payload.event || '').toLowerCase();
    const paymentEntity = payload?.payload?.payment?.entity || payload?.payment?.entity || {};
    const refundEntity = payload?.payload?.refund?.entity || payload?.refund?.entity || {};

    if (['payment.captured','order.paid'].includes(eventName)) {
      const providerOrderId = paymentEntity.order_id || payload?.payload?.order?.entity?.id || payload?.order?.id;
      const providerPaymentId = paymentEntity.id;
      const amountPaise = Number(paymentEntity.amount);
      const currency = String(paymentEntity.currency || 'INR');
      if (!eventId || !providerOrderId || !providerPaymentId || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || currency !== 'INR') return null;
      return {eventId:String(eventId),providerPaymentId:String(providerPaymentId),providerReference:String(providerPaymentId),providerOrderId:String(providerOrderId),amountPaise,currency,status:'paid'};
    }

    if (eventName === 'payment.failed') {
      const providerOrderId = paymentEntity.order_id;
      const providerPaymentId = paymentEntity.id;
      const amountPaise = Number(paymentEntity.amount);
      const currency = String(paymentEntity.currency || 'INR');
      if (!eventId || !providerOrderId || !providerPaymentId || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || currency !== 'INR') return null;
      return {eventId:String(eventId),providerPaymentId:String(providerPaymentId),providerReference:String(providerPaymentId),providerOrderId:String(providerOrderId),amountPaise,currency,status:'failed'};
    }

    if (eventName === 'refund.processed') {
      const providerOrderId = refundEntity.order_id || payload?.payload?.payment?.entity?.order_id;
      const providerPaymentId = refundEntity.payment_id || payload?.payload?.payment?.entity?.id;
      const providerReference = refundEntity.id;
      const amountPaise = Number(refundEntity.amount);
      const currency = String(refundEntity.currency || 'INR');
      if (!eventId || !providerOrderId || !providerPaymentId || !providerReference || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || currency !== 'INR') return null;
      return {eventId:String(eventId),providerPaymentId:String(providerPaymentId),providerReference:String(providerReference),providerOrderId:String(providerOrderId),amountPaise,currency,status:'refunded'};
    }

    // A failed/pending refund must remain refund_pending in RideOn. The provider
    // event is observable, but it must not overwrite a paid/refund_pending state.
    return null;
  }

  async function createVendorSettlement() {
    throw errorWithCode('Vendor settlement is not supported for the RideOn own-fleet payment model.', 'PAYMENT_VENDOR_SETTLEMENT_UNSUPPORTED');
  }
  async function getSettlementStatus() {
    throw errorWithCode('Vendor settlement is not supported for the RideOn own-fleet payment model.', 'PAYMENT_VENDOR_SETTLEMENT_UNSUPPORTED');
  }
  async function reconcileTransaction() {
    if (selectedProvider === 'mock') return {reconciled:true};
    if (!razorpayConfigured) throw errorWithCode('Razorpay payment provider is not configured.', 'PAYMENT_PROVIDER_CONFIGURATION_REQUIRED');
    return {reconciled:false,provider:'razorpay',message:'Use provider status lookup and webhook reconciliation for payment records.'};
  }

  return {
    provider:selectedProvider,
    name:selectedProvider,
    configured:selectedProvider === 'mock' || razorpayConfigured,
    capabilities,
    verifyWebhook,
    parseWebhook,
    verifyCheckoutSignature,
    getCheckoutConfig,
    canTransition:transition,
    createCustomerPayment,
    verifyPayment,
    refundPayment,
    createVendorSettlement,
    getSettlementStatus,
    reconcileTransaction,
  };
}
