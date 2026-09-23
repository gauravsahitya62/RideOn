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
    log('verifyEmailOtp:start', { email, tokenLength: token?.length });

    try {
      const result = await rideOnApi.verifyOtp({ email, token });
      const accessToken = result?.accessToken || result?.data?.accessToken;
      if (!accessToken) throw new Error('RideOn did not return a valid authentication session.');

      await persistAccessToken(accessToken);
      setAccessToken(accessToken);
      log('verifyEmailOtp:api:success');

      return {
        access_token: accessToken,
        refresh_token: result?.data?.refreshToken,
        expires_in: result?.data?.expiresIn,
      };
    } catch (apiError) {
      log('verifyEmailOtp:api:failed', {
        message: apiError?.message,
        code: apiError?.code,
        status: apiError?.status,
      });

      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw apiError;

      const response = await fetch(SUPABASE_URL + '/auth/v1/verify', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: 'Bearer ' + SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          token,
          type: 'email',
        }),
      });

      const payload = await response.json().catch(() => ({}));
      log('verifyEmailOtp:supabase:response', {
        status: response.status,
        ok: response.ok,
        error: response.ok ? undefined : payload,
      });

      if (!response.ok || !payload?.access_token) {
        const error = new Error(
          payload?.msg ||
            payload?.message ||
            payload?.error_description ||
            'The verification code is invalid or expired.'
        );
        error.code = payload?.error || payload?.error_code;
        error.status = response.status;
        throw error;
      }

      await persistAccessToken(payload.access_token);
      setAccessToken(payload.access_token);

      return {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_in: payload.expires_in,
      };
    }
  },

  async restoreSession() {
    const token = await restoreAccessToken();
    if (!token) return null;

    setAccessToken(token);

    try {
      const user = await this.currentUser();
      return { token, user };
    } catch (error) {
      await this.signOut();
      throw error;
    }
  },

  async currentUser() {
    try {
      const result = await rideOnApi.me();
      const user = result?.user;

      if (!user?.id || !['customer', 'vendor'].includes(user.role)) {
        throw new Error('Your RideOn account has no valid role.');
      }

      return user;
    } catch (apiError) {
      log('currentUser:api:failed', {
        message: apiError?.message,
        status: apiError?.status,
      });

      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !accessToken) {
        throw apiError;
      }

      const response = await fetch(SUPABASE_URL + '/auth/v1/user', {
        method: 'GET',
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: 'Bearer ' + accessToken,
        },
      });
      const payload = await response.json().catch(() => ({}));

      log('currentUser:supabase:response', {
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok || !payload?.id || !payload?.email) {
        throw apiError;
      }

      const metadata = payload.user_metadata || {};
      return {
        id: payload.id,
        name: metadata.full_name || metadata.name || payload.email.split('@')[0],
        email: payload.email,
        role: 'customer',
      };
    }
  },

  async signOut() {
    await clearStoredAccessToken();
    setAccessToken(null);
  },
};

export function normalizeAuthError(error) {
  const message = String(error?.message || 'Unable to authenticate with RideOn.');

  if (/unexpected_failure|error sending confirmation email/i.test(message)) {
    return 'Supabase could not send the confirmation email. Configure/check the Supabase Auth email SMTP provider, then try again.';
  }

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
