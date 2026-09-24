import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export function createAuth({ jwtSecret, accessTokenTtlSeconds = 3600, bcryptRounds = 12, identityResolver = null }) {
  if (!jwtSecret && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production');
  const secret = jwtSecret || 'development-only-secret';
  const hashPassword = (password) => bcrypt.hash(password, bcryptRounds);
  const verifyPassword = (password, hash) => bcrypt.compare(password, hash);
  const sign = (payload) => jwt.sign(payload, secret, { expiresIn: accessTokenTtlSeconds });
  const middleware = () => async (req, res, next) => {
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' } });
    try {
      const payload = jwt.verify(token, secret);
      if (!payload?.sub) throw new Error('invalid claims');
      const identity = identityResolver ? await identityResolver(String(payload.sub)) : null;
      if (!identity?.id || !['customer','vendor','support','admin'].includes(identity.role)) throw new Error('invalid identity');
      if (['customer','vendor'].includes(identity.role) && identity.accountStatus === 'suspended') {
        const error = new Error('Account suspended.'); error.code = 'ACCOUNT_SUSPENDED'; throw error;
      }
      req.user = { id: String(identity.id), role: identity.role, name: identity.fullName, email: identity.email, accountStatus: identity.accountStatus || 'active' };
      next();
    } catch (error) {
      if (error?.code === 'ACCOUNT_SUSPENDED') return res.status(403).json({ error: { code: 'ACCOUNT_SUSPENDED', message: 'This RideOn account is suspended.' } });
      return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Session is invalid or expired.' } });
    }
  };
  return { hashPassword, verifyPassword, sign, middleware, accessTokenTtlSeconds };
}
