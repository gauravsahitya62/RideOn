import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { KycEngine, createProviderFromEnv, sha256Document } from './kycEngine.js';

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

test('Cashfree document verification can approve without biometric fields', () => {
  const engine=new KycEngine({
    repository:repositoryFixture(),
    provider:{name:'cashfree',requiresBiometricChecks:()=>false},
  });
  assert.equal(engine.evaluateProviderResult({status:'APPROVED'}).status,'APPROVED');
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


test('provider approval is represented as customer VERIFIED state', async () => {
  const repository=repositoryFixture();
  const provider={
    name:'test',
    async verifyIdentity(){return {status:'APPROVED',livenessScore:0.95,faceMatchScore:0.93,providerVerificationId:'pv-1'};},
  };
  const engine=new KycEngine({repository,provider});
  const verification=await engine.verify({
    customerId:'customer-1',
    documentType:'DRIVING_LICENSE',
    documentNumber:'DL-AB123456',
    documentImageBase64:'x'.repeat(100),
    selfieImageBase64:'x'.repeat(100),
  });
  assert.equal(verification.documentStatus,'APPROVED');
  assert.equal(repository.customers.get('customer-1').kycStatus,'VERIFIED');
});


test('Cashfree Secure ID adapter sends the Driving Licence payload and maps id_found to APPROVED', async () => {
  const envKeys = [
    'KYC_PROVIDER','KYC_PROVIDER_VERIFY_URL','KYC_PROVIDER_CLIENT_ID',
    'KYC_PROVIDER_CLIENT_SECRET','KYC_PROVIDER_API_VERSION'
  ];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;

  try {
    process.env.KYC_PROVIDER='cashfree';
    process.env.KYC_PROVIDER_VERIFY_URL='https://sandbox.cashfree.com/verification/driving-license';
    process.env.KYC_PROVIDER_CLIENT_ID='test-client';
    process.env.KYC_PROVIDER_CLIENT_SECRET='test-secret';
    process.env.KYC_PROVIDER_API_VERSION='2024-12-01';

    let request;
    globalThis.fetch = async (url, options) => {
      request={url,options};
      return new Response(JSON.stringify({
        status:'id_found',
        reference_id:12345,
        details_of_driving_licence:{status:'ACTIVE'}
      }), {status:200,headers:{'content-type':'application/json'}});
    };

    const provider=createProviderFromEnv();
    const result=await provider.verifyIdentity({
      documentType:'DRIVING_LICENSE',
      documentNumber:'RJ1420200012345',
      dateOfBirth:'1994-08-05',
      clientReferenceId:'verification-1',
    });

    assert.equal(result.status,'APPROVED');
    assert.equal(result.providerVerificationId,'12345');
    assert.equal(request.url,'https://sandbox.cashfree.com/verification/driving-license');

    const body=JSON.parse(request.options.body);
    assert.deepEqual(body,{
      verification_id:'verification-1',
      dl_number:'RJ1420200012345',
      dob:'1994-08-05',
    });
    assert.equal(request.options.headers['x-client-id'],'test-client');
    assert.equal(request.options.headers['x-client-secret'],'test-secret');
    assert.equal(request.options.headers['x-api-version'],'2024-12-01');
  } finally {
    globalThis.fetch=originalFetch;
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key]=previous[key];
    }
  }
});


test('Cashfree Secure ID DigiLocker Aadhaar flow creates URL and fetches authenticated document', async () => {
  const envKeys = [
    'KYC_PROVIDER','KYC_PROVIDER_VERIFY_URL','KYC_PROVIDER_CLIENT_ID',
    'KYC_PROVIDER_CLIENT_SECRET','KYC_PROVIDER_API_VERSION'
  ];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    process.env.KYC_PROVIDER='cashfree';
    process.env.KYC_PROVIDER_VERIFY_URL='https://sandbox.cashfree.com/verification/driving-license';
    process.env.KYC_PROVIDER_CLIENT_ID='test-client';
    process.env.KYC_PROVIDER_CLIENT_SECRET='test-secret';
    process.env.KYC_PROVIDER_API_VERSION='2024-12-01';

    globalThis.fetch = async (url, options) => {
      calls.push({url,options});
      if (options?.method === 'POST') {
        return new Response(JSON.stringify({
          verification_id:'kyc-aadhaar-1',
          reference_id:456,
          url:'https://sandbox.cashfree.com/verification/digilocker/test',
          status:'PENDING',
          document_requested:['AADHAAR'],
        }), {status:200,headers:{'content-type':'application/json'}});
      }
      if (String(url).includes('/digilocker/document/AADHAAR')) {
        return new Response(JSON.stringify({
          status:'SUCCESS',
          uid:'XXXX-XXXX-1234',
          name:'RideOn Test User',
        }), {status:200,headers:{'content-type':'application/json'}});
      }
      return new Response(JSON.stringify({
        status:'AUTHENTICATED',
        verification_id:'kyc-aadhaar-1',
        reference_id:456,
        document_requested:['AADHAAR'],
        document_consent:['AADHAAR'],
      }), {status:200,headers:{'content-type':'application/json'}});
    };

    const provider=createProviderFromEnv();
    const created=await provider.createAadhaarDigiLockerUrl({
      verificationId:'verification-1',
      redirectUrl:'https://rideon-api-262g.onrender.com/api/v1/kyc/digilocker/callback',
    });
    assert.equal(created.verification_id,'kyc-aadhaar-1');
    assert.equal(calls[0].url,'https://sandbox.cashfree.com/verification/digilocker');
    assert.deepEqual(JSON.parse(calls[0].options.body),{
      verification_id:'verification-1',
      document_requested:['AADHAAR'],
      redirect_url:'https://rideon-api-262g.onrender.com/api/v1/kyc/digilocker/callback',
    });

    const status=await provider.getAadhaarDigiLockerStatus({verificationId:'kyc-aadhaar-1'});
    assert.equal(status.status,'AUTHENTICATED');

    const document=await provider.getAadhaarDigiLockerDocument({verificationId:'kyc-aadhaar-1'});
    assert.equal(document.status,'SUCCESS');
    assert.equal(document.uid,'XXXX-XXXX-1234');
    assert.match(calls[1].url,/\/digilocker\?/);
    assert.match(calls[2].url,/\/digilocker\/document\/AADHAAR\?/);
  } finally {
    globalThis.fetch=originalFetch;
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key]=previous[key];
    }
  }
});


test('Cashfree Secure ID Aadhaar number flow sends OTP and verifies it', async () => {
  const envKeys=['KYC_PROVIDER','KYC_PROVIDER_VERIFY_URL','KYC_PROVIDER_CLIENT_ID','KYC_PROVIDER_CLIENT_SECRET','KYC_PROVIDER_API_VERSION'];
  const previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  const originalFetch=globalThis.fetch;
  const calls=[];
  try {
    process.env.KYC_PROVIDER='cashfree';
    process.env.KYC_PROVIDER_VERIFY_URL='https://sandbox.cashfree.com/verification/driving-license';
    process.env.KYC_PROVIDER_CLIENT_ID='test-client';
    process.env.KYC_PROVIDER_CLIENT_SECRET='test-secret';
    process.env.KYC_PROVIDER_API_VERSION='2024-12-01';
    globalThis.fetch=async (url,options)=>{
      calls.push({url,options});
      return new Response(JSON.stringify(
        String(url).includes('/offline-aadhaar/otp')
          ? {ref_id:'aadhaar-ref-1',status:'SUCCESS',message:'OTP sent'}
          : {ref_id:'aadhaar-ref-1',status:'SUCCESS',name:'RideOn Test User',dob:'1994-08-05'}
      ),{status:200,headers:{'content-type':'application/json'}});
    };
    const provider=createProviderFromEnv();
    const otp=await provider.sendAadhaarOtp({aadhaarNumber:'123456789012',verificationId:'verification-1'});
    assert.equal(otp.ref_id,'aadhaar-ref-1');
    assert.equal(calls[0].url,'https://sandbox.cashfree.com/verification/offline-aadhaar/otp');
    assert.deepEqual(JSON.parse(calls[0].options.body),{aadhaar_number:'123456789012'});
    const verified=await provider.verifyAadhaarOtp({otp:'123456',referenceId:'aadhaar-ref-1'});
    assert.equal(verified.status,'SUCCESS');
    assert.equal(calls[1].url,'https://sandbox.cashfree.com/verification/offline-aadhaar/verify');
    assert.deepEqual(JSON.parse(calls[1].options.body),{otp:'123456',ref_id:'aadhaar-ref-1'});
  } finally {
    globalThis.fetch=originalFetch;
    for(const key of envKeys) {
      if(previous[key]===undefined) delete process.env[key];
      else process.env[key]=previous[key];
    }
  }
});
