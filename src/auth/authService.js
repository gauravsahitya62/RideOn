import { clearStoredAccessToken, persistAccessToken, restoreAccessToken, setAccessToken, rideOnApi } from '../services/api';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

async function verifySupabaseEmailOtp(email, token) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase authentication is not configured in this build.');
  const response = await fetch(SUPABASE_URL + '/auth/v1/verify', {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, token, type: 'email' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.msg || payload?.error_description || 'The verification code is invalid or expired.');
  return payload;
}

export const authService = {
  async sendEmailOtp({ email, fullName }) {
    return rideOnApi.requestOtp({ email, fullName });
  },
  async verifyEmailOtp(email, token) {
    const session = await verifySupabaseEmailOtp(email, token);
    if (!session?.access_token) throw new Error('Supabase did not return a valid session.');
    await persistAccessToken(session.access_token);
    setAccessToken(session.access_token);
    return session;
  },
  async restoreSession() {
    const token = await restoreAccessToken();
    if (!token) return null;
    setAccessToken(token);
    try {
      const result = await rideOnApi.me();
      const user = result?.user;
      if (!user?.id || !['customer', 'vendor'].includes(user.role)) throw new Error('Your RideOn account has no valid role.');
      return { token, user };
    } catch (error) {
      await this.signOut();
      throw error;
    }
  },
  async currentUser() {
    const result = await rideOnApi.me();
    const user = result?.user;
    if (!user?.id || !['customer', 'vendor'].includes(user.role)) throw new Error('Your RideOn account has no valid role.');
    return user;
  },
  async signOut() {
    await clearStoredAccessToken();
    setAccessToken(null);
  },
};

export function normalizeAuthError(error) {
  const message = String(error?.message || 'Unable to authenticate with RideOn.');
  if (/401|invalid|expired|session/i.test(message)) return 'Your session is invalid or expired. Please sign in again.';
  if (/network|unreachable|timed out/i.test(message)) return 'RideOn could not reach the server. Check your connection and try again.';
  return message;
}
