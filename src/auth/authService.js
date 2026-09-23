import { clearStoredAccessToken, persistAccessToken, restoreAccessToken, setAccessToken, rideOnApi } from '../services/api';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const log = (...args) => console.log('[RideOnAuth]', ...args);

export const authService = {
  async sendEmailOtp({ email, fullName }) {
    log('sendEmailOtp:start', {
      email,
      hasSupabaseUrl: Boolean(SUPABASE_URL),
      hasSupabaseKey: Boolean(SUPABASE_PUBLISHABLE_KEY),
    });

    try {
      const result = await rideOnApi.requestOtp({ email, fullName });
      log('sendEmailOtp:api:success');
      return result;
    } catch (apiError) {
      log('sendEmailOtp:api:failed', apiError?.message);

      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        throw apiError;
      }

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
          ...(fullName ? { data: { full_name: fullName } } : {}),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      log('sendEmailOtp:supabase:response', {
        status: response.status,
        ok: response.ok,
        error: response.ok ? undefined : payload,
      });

      if (!response.ok) {
        const error = new Error(
          payload?.msg ||
            payload?.message ||
            payload?.error_description ||
            'Supabase could not send the verification email.'
        );
        error.code = payload?.error || payload?.error_code;
        error.status = response.status;
        throw error;
      }

      return payload;
    }
  },

  async verifyEmailOtp(email, token) {
    const result = await rideOnApi.verifyOtp({ email, token });
    const accessToken = result?.accessToken || result?.data?.accessToken;

    if (!accessToken) {
      throw new Error('RideOn did not return a valid authentication session.');
    }

    await persistAccessToken(accessToken);
    setAccessToken(accessToken);

    return {
      access_token: accessToken,
      refresh_token: result?.data?.refreshToken,
      expires_in: result?.data?.expiresIn,
    };
  },

  async restoreSession() {
    const token = await restoreAccessToken();
    if (!token) return null;

    setAccessToken(token);

    try {
      const result = await rideOnApi.me();
      const user = result?.user;

      if (!user?.id || !['customer', 'vendor'].includes(user.role)) {
        throw new Error('Your RideOn account has no valid role.');
      }

      return { token, user };
    } catch (error) {
      await this.signOut();
      throw error;
    }
  },

  async currentUser() {
    const result = await rideOnApi.me();
    const user = result?.user;

    if (!user?.id || !['customer', 'vendor'].includes(user.role)) {
      throw new Error('Your RideOn account has no valid role.');
    }

    return user;
  },

  async signOut() {
    await clearStoredAccessToken();
    setAccessToken(null);
  },
};

export function normalizeAuthError(error) {
  const message = String(error?.message || 'Unable to authenticate with RideOn.');

  if (/network|unreachable|timed out|failed to fetch|network request failed/i.test(message)) {
    return 'Authentication network request failed. Check your connection and try again.';
  }

  if (/supabase.*not configured/i.test(message)) {
    return 'Supabase authentication is not configured in this build.';
  }

  if (/401|invalid|expired|session/i.test(message)) {
    return 'Your session is invalid or expired. Please sign in again.';
  }

  return message;
}
