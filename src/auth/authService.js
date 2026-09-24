import { clearStoredAccessToken, persistAccessToken, restoreAccessToken, setAccessToken, rideOnApi } from '../services/api';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const authService = {
  async sendEmailOtp({ email, fullName }) {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Error('Supabase authentication is not configured in this build.');
    }
    try {
      return await rideOnApi.requestOtp({ email, fullName });
    } catch (apiError) {
      // The backend is the source of truth for RideOn authentication. Do not
      // silently fall back to direct Supabase OTP here because doing so can
      // hide a broken/old Render deployment and desynchronise auth state.
      throw apiError;
    }
  },

  async verifyEmailOtp(email, token) {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Error('Supabase authentication is not configured in this build.');
    }
    const result=await rideOnApi.verifyOtp({ email, token });
    const accessToken=result?.accessToken||result?.data?.accessToken;
    if(!accessToken) throw new Error('RideOn did not return a valid authentication session.');
    await persistAccessToken(accessToken);
    setAccessToken(accessToken);
    return {
      access_token:accessToken,
      refresh_token:result?.refreshToken||result?.data?.refreshToken,
      expires_in:result?.expiresIn||result?.data?.expiresIn,
    };
  },

  async restoreSession() {
    const token=await restoreAccessToken();
    if(!token) return null;
    setAccessToken(token);
    try { return {token,user:await this.currentUser()}; }
    catch(error){ await this.signOut(); throw error; }
  },

  async completeRegistration({accessToken,accountType,fullName,phone}) {
    console.log('[RideOnAuth][COMPLETE_REGISTRATION_START]', JSON.stringify({
      accountType, fullNameLength: String(fullName || '').length, hasPhone: Boolean(phone),
      hasAccessToken: Boolean(accessToken)
    }));
    setAccessToken(accessToken);
    try {
      const result = await rideOnApi.completeRegistration({accountType,fullName,phone});
      console.log('[RideOnAuth][COMPLETE_REGISTRATION_SUCCESS]', JSON.stringify({
        role: result?.user?.role, userId: result?.user?.id || null
      }));
      return result;
    } catch (error) {
      console.error('[RideOnAuth][COMPLETE_REGISTRATION_ERROR]', JSON.stringify({
        status: error?.status, code: error?.code, path: error?.path, message: error?.message
      }));
      throw error;
    }
  },

  async currentUser({requestedRole,registrationProfile}={}) {
    try {
      const result=await rideOnApi.me();
      const user=result?.user;
      if(!user?.id||!['customer','vendor'].includes(user.role)) throw new Error('Your RideOn account has no valid role.');
      return user;
    } catch(apiError) {
      const token=await restoreAccessToken();
      if(!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY||!token) throw apiError;
      // A Supabase-only fallback is intentionally NOT allowed to invent a RideOn role.
      // The backend is the authority for customer/vendor identity.
      const response=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token}});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload?.id||!payload?.email) throw apiError;
      throw new Error('Unable to determine your RideOn account type right now. Please try again.');
    }
  },

  async signOut(){await clearStoredAccessToken();setAccessToken(null);},
};

export function normalizeAuthError(error) {
  const message=String(error?.message||'Unable to authenticate with RideOn.');
  if(/unexpected_failure|error sending confirmation email/i.test(message)) return 'Supabase could not send the confirmation email. Configure/check the Supabase Auth email SMTP provider, then try again.';
  if(/network|unreachable|timed out|failed to fetch|network request failed/i.test(message)) return 'Authentication network request failed. Check your connection and try again.';
  if(/could not determine.*account type|no valid role|role/i.test(message)) return 'We could not determine your RideOn account type. Please try again.';
  if(/supabase.*not configured/i.test(message)) return 'Supabase authentication is not configured in this build.';
  if(/401|invalid|expired|session/i.test(message)) return 'Your session is invalid or expired. Please sign in again.';
  if(/403|permission/i.test(message)) return 'You do not have permission to access this resource.';
  return message;
}
