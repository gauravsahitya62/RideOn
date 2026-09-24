import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';

const { createAuth } = await import('./auth.js');

test('legacy JWT role is ignored and server identity role is authoritative', async () => {
  const secret = 'test-secret';
  const auth = createAuth({
    jwtSecret: secret,
    identityResolver: async id => ({
      id,
      role: 'admin',
      fullName: 'RideOn Admin',
      email: 'admin@example.com',
      accountStatus: 'active'
    })
  });

  const token = auth.sign({ sub: 'user-1', role: 'customer' });
  const req = {
    get: () => 'Bearer ' + token
  };
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; }
  };

  let nextCalled = false;
  await auth.middleware()(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.user.role, 'admin');
});

test('suspended customer is blocked server-side', async () => {
  const secret = 'test-secret';
  const auth = createAuth({
    jwtSecret: secret,
    identityResolver: async id => ({
      id,
      role: 'customer',
      fullName: 'Suspended Customer',
      email: 'customer@example.com',
      accountStatus: 'suspended'
    })
  });

  const token = auth.sign({ sub: 'user-2', role: 'customer' });
  const req = {
    get: () => 'Bearer ' + token
  };
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; }
  };

  let nextCalled = false;
  await auth.middleware()(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.code, 403);
  assert.equal(res.body.error.code, 'ACCOUNT_SUSPENDED');
});

test('malformed token is rejected even when frontend supplies admin-like role', async () => {
  const auth = createAuth({
    jwtSecret: 'test-secret',
    identityResolver: async () => ({
      id: 'x',
      role: 'admin',
      fullName: 'Admin',
      accountStatus: 'active'
    })
  });

  const req = {
    get: () => 'Bearer not-a-real-token'
  };
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; }
  };

  let nextCalled = false;
  await auth.middleware()(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.code, 401);
  assert.equal(res.body.error.code, 'INVALID_TOKEN');
});
