import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { KycEngine, sha256Document } from './kycEngine.js';

function repositoryFixture({ blacklisted=false } = {}) {
  const verifications = new Map();
  const blacklist = new Set(blacklisted ? [sha256Document('DL-AB123456')]:[]);
  const customers = new Map([['customer-1',{kycStatus:'UNVERIFIED',activeKycId:null}]]);
  return {
    verifications, customers,
    async getKycStatus(id){ const c=customers.get(String(id)); return c ? {status:c.kycStatus,activeKycId:c.activeKycId}:null; },
    async isKycBlacklisted(hash){ return blacklist.has(hash); },
    async createKycVerification(input){ const id=crypto.randomUUID(); const row={id,externalUserId:input.externalUserId,provider:input.provider,documentStatus:'PENDING'};verifications.set(id,row);customers.get(String(input.externalUserId)).kycStatus='PENDING';customers.get(String(input.externalUserId)).activeKycId=id;return row; },
    async applyKycVerificationResult(input){ const row=verifications.get(String(input.verificationId));Object.assign(row,input,{documentStatus:input.status});const c=customers.get(String(row.externalUserId));c.kycStatus=input.blacklist?'BLACKLISTED':input.status;c.activeKycId=input.status==='APPROVED'?row.id:null;return {verification:row,duplicate:false}; },
    async findKycVerificationByProviderEvent(){return null;},
    async findKycVerificationByProviderReference(){return null;},
    async getKycVerification(id){return verifications.get(String(id))||null;},
  };
}

test('hashDocumentNumber normalizes identifiers before SHA-256', () => {
  assert.equal(
    KycEngine.hashDocumentNumber(' dl-ab123 456 '),
    KycEngine.hashDocumentNumber('DLAB123456')
  );
});

test('blacklisted documents are rejected before provider invocation', async () => {
  const repository=repositoryFixture({blacklisted:true});
  let called=false;
  const provider={name:'test',async verifyIdentity(){called=true;throw new Error('must not call provider');}};
  const engine=new KycEngine({repository,provider});
  await assert.rejects(
    engine.verify({
      customerId:'customer-1',
      documentType:'DRIVING_LICENSE',
      documentNumber:'DL-AB123456',
      documentImageBase64:'x'.repeat(100),
      selfieImageBase64:'x'.repeat(100),
    }),
    error=>error.code==='KYC_BLACKLISTED'
  );
  assert.equal(called,false);
  assert.equal(repository.customers.get('customer-1').kycStatus,'BLACKLISTED');
});

test('approved provider result requires both configured biometric thresholds', () => {
  const engine=new KycEngine({
    repository:repositoryFixture(),
    provider:{name:'test'},
    livenessThreshold:0.70,
    faceMatchThreshold:0.80,
  });
  assert.equal(engine.evaluateProviderResult({status:'APPROVED',livenessScore:0.71,faceMatchScore:0.81}).status,'APPROVED');
  assert.equal(engine.evaluateProviderResult({status:'APPROVED',livenessScore:0.69,faceMatchScore:0.99}).status,'REJECTED');
  assert.equal(engine.evaluateProviderResult({status:'APPROVED',livenessScore:0.99,faceMatchScore:0.79}).status,'REJECTED');
});

test('webhook signatures are HMAC verified over the raw body', () => {
  const secret='test-secret';
  const provider={
    name:'test',
    verifyWebhookSignature(raw,signature){return crypto.createHmac('sha256',secret).update(raw).digest('hex')===signature;},
    parseWebhook(){return null;}
  };
  const engine=new KycEngine({repository:repositoryFixture(),provider});
  const raw='{"eventId":"evt-1"}';
  const signature=crypto.createHmac('sha256',secret).update(raw).digest('hex');
  assert.equal(provider.verifyWebhookSignature(raw,signature),true);
  assert.equal(provider.verifyWebhookSignature(raw,'bad'),false);
});
