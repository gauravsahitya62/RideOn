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

const authLog = (...args) => { try { console.log('[RideOnAuth]', ...args); } catch {} };
const authErrorLog = (...args) => { try { console.error('[RideOnAuth]', ...args); } catch {} };

export const authService = {
  async sendEmailOtp({ email, fullName }) {
    authLog('sendEmailOtp:start', {
      email,
      hasFullName: Boolean(fullName),
      apiUrl: process.env.EXPO_PUBLIC_API_URL || 'default-render-api',
      hasSupabaseUrl: Boolean(SUPABASE_URL),
      hasSupabaseKey: Boolean(SUPABASE_PUBLISHABLE_KEY),
    });

    try {
      const result = await rideOnApi.requestOtp({ email, fullName });
      authLog('sendEmailOtp:rideon-api:success', { hasResponse: Boolean(result) });
      return result;
    } catch (apiError) {
      authErrorLog('sendEmailOtp:rideon-api:failed', {
        message: apiError?.message,
        code: apiError?.code,
        status: apiError?.status,
      });

      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        authErrorLog('sendEmailOtp:supabase-fallback:unavailable', {
          hasSupabaseUrl: Boolean(SUPABASE_URL),
          hasSupabaseKey: Boolean(SUPABASE_PUBLISHABLE_KEY),
        });
        throw apiError;
      }

      try {
        const supabaseHost = SUPABASE_URL.replace(/^https?:\/\//, '').split('/')[0];
        authLog('sendEmailOtp:supabase-fallback:start', { supabaseHost });

        const response = await fetch(SUPABASE_URL + '/auth/v1/otp', {
          method: 'POST',
          headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: 'Bearer ' + SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            create_user: true,
            data: fullName ? { full_name: fullName } : undefined,
          }),
        });

        const payload = await response.json().catch(() => ({}));

        authLog('sendEmailOtp:supabase-fallback:response', {
          status: response.status,
          ok: response.ok,
          payload: response.ok ? { ok: true } : payload,
        });

        if (!response.ok) {
          const fallbackError = new Error(
            payload?.msg ||
            payload?.message ||
            payload?.error_description ||
            'Supabase could not send the verification email.'
          );
          fallbackError.code = payload?.error || payload?.error_code || null;
          fallbackError.status = response.status;
          throw fallbackError;
        }

        return payload;
      } catch (supabaseError) {
        authErrorLog('sendEmailOtp:supabase-fallback:failed', {
          message: supabaseError?.message,
          code: supabaseError?.code,
          status: supabaseError?.status,
        });
        throw supabaseError;
      }
    }
  },
  async verifyEmailOtp(email, token) {
    const result = await rideOnApi.verifyOtp({ email, token });
    const accessToken = result?.accessToken || result?.data?.accessToken;
    if (!accessToken) throw new Error('RideOn did not return a valid authentication session.');
    await persistAccessToken(accessToken);
    setAccessToken(accessToken);
    return { access_token:accessToken, refresh_token:result?.data?.refreshToken, expires_in:result?.data?.expiresIn };
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
  if (/supabase.*not configured/i.test(message)) return 'Supabase authentication is not configured in this build. Rebuild the app with the Supabase public environment variables.';
  return message;
}
