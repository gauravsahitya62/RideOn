import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export function createAuth({ jwtSecret, accessTokenTtlSeconds = 3600, bcryptRounds = 12, authEnvironment } = {}) {
  if (!jwtSecret && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production');
  const secret = jwtSecret || 'development-only-secret';
  const environment = String(authEnvironment || process.env.RIDEON_AUTH_ENV || process.env.NODE_ENV || 'development');
  const issuer = 'rideon-api';
  const audience = 'rideon-mobile';
  const hashPassword = (password) => bcrypt.hash(password, bcryptRounds);
  const verifyPassword = (password, hash) => bcrypt.compare(password, hash);
  const sign = (payload) => jwt.sign(
    { ...payload, authEnvironment: environment },
    secret,
    { expiresIn: accessTokenTtlSeconds, issuer, audience }
  );
  const middleware = () => (req, res, next) => {
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' } });
    try {
      const payload = jwt.verify(token, secret, { issuer, audience });
      if (!payload?.sub || !['customer', 'vendor'].includes(payload.role) || payload.authEnvironment !== environment) throw new Error('invalid claims');
      req.user = { id: String(payload.sub), role: payload.role };
      next();
    } catch {
      return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Session is invalid or expired.' } });
    }
  };
  return { hashPassword, verifyPassword, sign, middleware, accessTokenTtlSeconds };
}
