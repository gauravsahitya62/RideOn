import crypto from 'node:crypto';

const PROVIDERS = new Set(['cashfree','signzy','hyperverge']);

const normalizeDocumentNumber = (value) =>
  String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const sha256Document = (value) =>
  crypto.createHash('sha256').update(normalizeDocumentNumber(value), 'utf8').digest('hex');

const clampScore = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
};

const firstValue = (obj, paths) => {
  for (const path of paths) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) current = current?.[part];
    if (current !== undefined && current !== null && current !== '') return current;
  }
  return null;
};

class HttpKycProvider {
  constructor({ name, verifyUrl, apiKey, clientId, clientSecret, webhookSecret, timeoutMs = 30000, version }) {
    this.name = name;
    this.verifyUrl = verifyUrl;
    this.apiKey = apiKey;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.webhookSecret = webhookSecret;
    this.timeoutMs = timeoutMs;
    this.version = version;
  }

  headers() {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  async verifyIdentity(input) {
    if (!this.verifyUrl) {
      throw Object.assign(new Error('KYC provider verification endpoint is not configured.'), { code: 'KYC_PROVIDER_CONFIGURATION_REQUIRED' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.verifyUrl, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch {
        throw Object.assign(new Error('KYC provider returned a non-JSON response.'), { code: 'KYC_PROVIDER_INVALID_RESPONSE' });
      }
      if (!response.ok) {
        throw Object.assign(new Error('KYC provider rejected the verification request.'), {
          code: 'KYC_PROVIDER_REQUEST_FAILED',
          status: response.status,
        });
      }
      return this.normalizeVerificationResponse(payload);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw Object.assign(new Error('KYC provider request timed out.'), { code: 'KYC_PROVIDER_TIMEOUT' });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  normalizeVerificationResponse(payload) {
    const statusRaw = String(firstValue(payload, [
      'status', 'verificationStatus', 'verification.status', 'data.status',
      'data.verificationStatus', 'result.status', 'result.verificationStatus',
    ]) || 'PENDING').toUpperCase();

    const mappedStatus =
      ['APPROVED','VERIFIED','SUCCESS','COMPLETED'].includes(statusRaw) ? 'APPROVED' :
      ['REJECTED','FAILED','FAILURE','DECLINED'].includes(statusRaw) ? 'REJECTED' : 'PENDING';

    return {
      status: mappedStatus,
      providerVerificationId: String(firstValue(payload, [
        'verificationId', 'requestId', 'referenceId', 'clientReferenceId', 'id',
        'data.verificationId', 'data.requestId', 'data.referenceId', 'data.id',
      ]) || ''),
      governmentRefId: firstValue(payload, [
        'governmentRefId', 'governmentReferenceId', 'data.governmentRefId',
        'data.governmentReferenceId', 'result.governmentRefId',
      ]),
      ocrDataExtracted: firstValue(payload, [
        'ocrDataExtracted', 'ocr', 'data.ocrDataExtracted', 'data.ocr', 'result.ocr',
      ]) || {},
      livenessScore: clampScore(firstValue(payload, [
        'livenessScore', 'liveness.score', 'data.livenessScore',
        'data.liveness.score', 'result.livenessScore',
      ])),
      faceMatchScore: clampScore(firstValue(payload, [
        'faceMatchScore', 'faceMatch.score', 'data.faceMatchScore',
        'data.faceMatch.score', 'result.faceMatchScore',
      ])),
      decisionReason: firstValue(payload, [
        'reason', 'message', 'failureReason', 'data.reason', 'data.message',
        'result.reason',
      ]),
      raw: payload,
    };
  }

  verifyWebhookSignature(rawBody, signature, timestamp = '') {
    if (!this.webhookSecret || !signature) return false;
    const raw = String(rawBody || '');
    const candidates = [raw];
    if (timestamp) candidates.push(timestamp + raw, timestamp + '.' + raw);
    return candidates.some(value => {
      const digest = crypto.createHmac('sha256', this.webhookSecret).update(value, 'utf8');
      const expectedHex = digest.digest('hex');
      const expectedBase64 = crypto.createHmac('sha256', this.webhookSecret).update(value, 'utf8').digest('base64');
      const provided = String(signature).replace(/^sha256=/i, '').trim();
      const candidates = [expectedHex, expectedBase64];
      return candidates.some(expected => {
        const a = Buffer.from(provided, 'utf8');
        const b = Buffer.from(expected, 'utf8');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
      });
    });
  }

  parseWebhook(payload, headers = {}) {
    const eventId = String(
      headers['x-kyc-event-id'] || headers['x-event-id'] ||
      firstValue(payload, ['eventId','event_id','data.eventId','data.event_id','id']) || ''
    ).trim();
    if (!eventId) return null;

    const statusRaw = String(firstValue(payload, [
      'status','verificationStatus','data.status','data.verificationStatus',
      'result.status','result.verificationStatus',
    ]) || 'PENDING').toUpperCase();
    const status =
      ['APPROVED','VERIFIED','SUCCESS','COMPLETED'].includes(statusRaw) ? 'APPROVED' :
      ['REJECTED','FAILED','FAILURE','DECLINED'].includes(statusRaw) ? 'REJECTED' : 'PENDING';

    return {
      eventId,
      clientReferenceId: String(firstValue(payload, ['clientReferenceId','client_reference_id','data.clientReferenceId','data.client_reference_id']) || ''),
      providerVerificationId: String(firstValue(payload, [
        'verificationId','requestId','referenceId','id',
        'data.verificationId','data.requestId','data.referenceId','data.id',
      ]) || ''),
      status,
      governmentRefId: firstValue(payload, [
        'governmentRefId','governmentReferenceId','data.governmentRefId','data.governmentReferenceId',
      ]),
      ocrDataExtracted: firstValue(payload, [
        'ocrDataExtracted','ocr','data.ocrDataExtracted','data.ocr',
      ]) || {},
      livenessScore: clampScore(firstValue(payload, [
        'livenessScore','liveness.score','data.livenessScore','data.liveness.score',
      ])),
      faceMatchScore: clampScore(firstValue(payload, [
        'faceMatchScore','faceMatch.score','data.faceMatchScore','data.faceMatch.score',
      ])),
      decisionReason: firstValue(payload, [
        'reason','message','failureReason','data.reason','data.message',
      ]),
      externalUserId: firstValue(payload, ['externalUserId','customerId','data.externalUserId','data.customerId']),
      raw: payload,
    };
  }
}

class CashfreeVerificationAdapter extends HttpKycProvider {
  headers() {
    const headers = super.headers();
    if (this.clientId) headers['x-client-id'] = this.clientId;
    if (this.clientSecret) headers['x-client-secret'] = this.clientSecret;
    if (this.version) headers['x-api-version'] = this.version;
    if (this.apiKey) headers.Authorization = 'Bearer ' + this.apiKey;
    return headers;
  }
}

class SignzyVerificationAdapter extends HttpKycProvider {
  headers() {
    const headers = super.headers();
    if (this.apiKey) headers.Authorization = this.apiKey;
    if (this.clientId) headers['x-client-id'] = this.clientId;
    if (this.clientSecret) headers['x-client-secret'] = this.clientSecret;
    return headers;
  }
}

class HyperVergeVerificationAdapter extends HttpKycProvider {
  headers() {
    const headers = super.headers();
    if (this.clientId) headers.appId = this.clientId;
    if (this.clientSecret) headers.appKey = this.clientSecret;
    if (this.apiKey) headers.Authorization = 'Bearer ' + this.apiKey;
    return headers;
  }
}

function createProviderFromEnv(env = process.env) {
  const name = String(env.KYC_PROVIDER || '').trim().toLowerCase();
  if (!PROVIDERS.has(name)) {
    throw Object.assign(new Error('A supported KYC provider must be configured.'), { code: 'KYC_PROVIDER_CONFIGURATION_REQUIRED' });
  }
  const common = {
    name,
    verifyUrl: String(env.KYC_PROVIDER_VERIFY_URL || '').trim(),
    apiKey: String(env.KYC_PROVIDER_API_KEY || '').trim(),
    clientId: String(env.KYC_PROVIDER_CLIENT_ID || '').trim(),
    clientSecret: String(env.KYC_PROVIDER_CLIENT_SECRET || '').trim(),
    webhookSecret: String(env.KYC_WEBHOOK_SECRET || '').trim(),
    timeoutMs: Math.max(5000, Math.min(60000, Number(env.KYC_PROVIDER_TIMEOUT_MS || 30000))),
    version: String(env.KYC_PROVIDER_API_VERSION || '').trim(),
  };
  if (name === 'cashfree') return new CashfreeVerificationAdapter(common);
  if (name === 'signzy') return new SignzyVerificationAdapter(common);
  return new HyperVergeVerificationAdapter(common);
}

export class KycEngine {
  constructor({
    repository,
    provider = createProviderFromEnv(),
    clientId = process.env.KYC_CLIENT_ID || 'rideon_internal',
    livenessThreshold = Number(process.env.KYC_LIVENESS_THRESHOLD || 0.70),
    faceMatchThreshold = Number(process.env.KYC_FACE_MATCH_THRESHOLD || 0.80),
  }) {
    this.repository = repository;
    this.provider = provider;
    this.clientId = clientId;
    this.livenessThreshold = Math.max(0, Math.min(1, livenessThreshold));
    this.faceMatchThreshold = Math.max(0, Math.min(1, faceMatchThreshold));
  }

  static hashDocumentNumber(documentNumber) {
    return sha256Document(documentNumber);
  }

  async getStatus(customerId) {
    return this.repository.getKycStatus(customerId);
  }

  async verify({ customerId, documentType, documentNumber, documentImageBase64, selfieImageBase64 }) {
    const normalizedDocument = normalizeDocumentNumber(documentNumber);
    if (normalizedDocument.length < 6 || normalizedDocument.length > 40) {
      throw Object.assign(new Error('Enter a valid identity document number.'), { code: 'INVALID_DOCUMENT_NUMBER' });
    }
    if (!documentImageBase64 || !selfieImageBase64) {
      throw Object.assign(new Error('Both the identity document and live selfie are required.'), { code: 'KYC_IMAGES_REQUIRED' });
    }

    const documentHash = sha256Document(normalizedDocument);

    if (await this.repository.isKycBlacklisted(documentHash)) {
      const verification = await this.repository.createKycVerification({
        clientId:this.clientId,
        externalUserId:customerId,
        documentType,
        documentHash,
        provider:this.provider.name,
      });
      await this.repository.applyKycVerificationResult({
        verificationId:verification.id,
        status:'REJECTED',
        decisionReason:'Document matched the RideOn KYC risk blacklist.',
        blacklist:true,
      });
      throw Object.assign(new Error('Identity verification cannot be completed for this account.'), { code:'KYC_BLACKLISTED' });
    }

    const verification = await this.repository.createKycVerification({
      clientId:this.clientId,
      externalUserId:customerId,
      documentType,
      documentHash,
      provider:this.provider.name,
    });

    try {
      const result = await this.provider.verifyIdentity({
        clientId:this.clientId,
        externalUserId:String(customerId),
        documentType,
        documentNumber:normalizedDocument,
        documentImageBase64:String(documentImageBase64),
        selfieImageBase64:String(selfieImageBase64),
        callbackUrl:process.env.KYC_WEBHOOK_URL || undefined,
        clientReferenceId:String(verification.id),
      });

      const evaluated = this.evaluateProviderResult(result);
      const applied = await this.repository.applyKycVerificationResult({
        verificationId:verification.id,
        ...evaluated,
        providerVerificationId:result.providerVerificationId || null,
        decisionReason:evaluated.decisionReason || result.decisionReason || null,
      });
      return applied?.verification || null;
    } catch (error) {
      console.error(JSON.stringify({
        level:'error',
        event:'kyc_provider_request_failed',
        provider:this.provider.name,
        verificationId:verification.id,
        code:error?.code || 'KYC_PROVIDER_REQUEST_FAILED',
      }));
      throw error;
    }
  }

  evaluateProviderResult(result = {}) {
    const status = String(result.status || 'PENDING').toUpperCase();
    const liveness = result.livenessScore == null ? null : Number(result.livenessScore);
    const faceMatch = result.faceMatchScore == null ? null : Number(result.faceMatchScore);

    if (status === 'REJECTED') {
      return {
        status:'REJECTED',
        ocrDataExtracted:result.ocrDataExtracted || {},
        livenessScore:liveness,
        faceMatchScore:faceMatch,
        governmentRefId:result.governmentRefId || null,
        decisionReason:result.decisionReason || 'Identity provider rejected the verification.',
      };
    }

    if (status === 'PENDING') {
      return {
        status:'PENDING',
        ocrDataExtracted:result.ocrDataExtracted || {},
        livenessScore:liveness,
        faceMatchScore:faceMatch,
        governmentRefId:result.governmentRefId || null,
        decisionReason:result.decisionReason || 'Identity verification is awaiting provider confirmation.',
      };
    }

    const biometricComplete = liveness != null && faceMatch != null;
    const thresholdsPassed = biometricComplete &&
      liveness >= this.livenessThreshold &&
      faceMatch >= this.faceMatchThreshold;

    return {
      status:thresholdsPassed ? 'APPROVED' : 'REJECTED',
      ocrDataExtracted:result.ocrDataExtracted || {},
      livenessScore:liveness,
      faceMatchScore:faceMatch,
      governmentRefId:result.governmentRefId || null,
      decisionReason:thresholdsPassed
        ? 'Identity document and biometric checks passed configured thresholds.'
        : 'Biometric verification did not meet the configured RideOn thresholds.',
    };
  }

  async handleWebhook({ rawBody, payload, signature, timestamp, headers = {} }) {
    if (!this.provider.verifyWebhookSignature(rawBody, signature, timestamp)) {
      throw Object.assign(new Error('Invalid KYC provider signature.'), { code:'INVALID_KYC_WEBHOOK_SIGNATURE' });
    }

    const event = this.provider.parseWebhook(payload, headers);
    if (!event) throw Object.assign(new Error('KYC provider event is missing an event id.'), { code:'INVALID_KYC_WEBHOOK' });

    const existingEvent = await this.repository.findKycVerificationByProviderEvent(event.eventId);
    if (existingEvent) return { duplicate:true, verification:existingEvent };

    let verification = event.clientReferenceId && this.repository.findKycVerificationById
      ? await this.repository.findKycVerificationById(event.clientReferenceId)
      : null;

    if (!verification && event.providerVerificationId) {
      verification = await this.repository.findKycVerificationByProviderReference({
        provider:this.provider.name,
        providerVerificationId:event.providerVerificationId,
      });
    }

    if (!verification && event.externalUserId) {
      const status = await this.repository.getKycStatus(event.externalUserId);
      if (status?.activeKycId) verification = await this.repository.getKycVerification(status.activeKycId, event.externalUserId);
    }

    if (!verification) return { received:true, applied:false, duplicate:false };

    const evaluated = this.evaluateProviderResult(event);
    const applied = await this.repository.applyKycVerificationResult({
      verificationId:verification.id,
      ...evaluated,
      providerVerificationId:event.providerVerificationId || verification.providerVerificationId,
      providerEventId:event.eventId,
      governmentRefId:event.governmentRefId || null,
      decisionReason:evaluated.decisionReason || event.decisionReason || null,
    });

    return { received:true, applied:!applied?.duplicate, duplicate:Boolean(applied?.duplicate), verification:applied?.verification || verification };
  }
}

export { createProviderFromEnv, normalizeDocumentNumber, sha256Document };
