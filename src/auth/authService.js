import { clearStoredAccessToken, persistAccessToken, restoreAccessToken, setAccessToken, rideOnApi } from '../services/api';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const authService = {
  async sendEmailOtp({ email, fullName }) {
    try {
      return await rideOnApi.requestOtp({ email, fullName });
    } catch (apiError) {
      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw apiError;
      const response = await fetch(SUPABASE_URL + '/auth/v1/otp', {
        method:'POST',
        headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({email,create_user:true,...(fullName?{data:{full_name:fullName}}:{})}),
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok){
        const error=new Error(payload?.msg||payload?.message||payload?.error_description||'Supabase could not send the verification email.');
        error.code=payload?.error||payload?.error_code; error.status=response.status; throw error;
      }
      return payload;
    }
  },

  async verifyEmailOtp(email, token) {
    try {
      const result=await rideOnApi.verifyOtp({ email, token });
      const accessToken=result?.accessToken||result?.data?.accessToken;
      if(!accessToken) throw new Error('RideOn did not return a valid authentication session.');
      await persistAccessToken(accessToken); setAccessToken(accessToken);
      return {access_token:accessToken,refresh_token:result?.data?.refreshToken,expires_in:result?.data?.expiresIn};
    } catch(apiError) {
      if(!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY) throw apiError;
      const response=await fetch(SUPABASE_URL+'/auth/v1/verify',{
        method:'POST',
        headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({email,token,type:'email'}),
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload?.access_token){
        const error=new Error(payload?.msg||payload?.message||payload?.error_description||'The verification code is invalid or expired.');
        error.code=payload?.error||payload?.error_code; error.status=response.status; throw error;
      }
      await persistAccessToken(payload.access_token); setAccessToken(payload.access_token);
      return {access_token:payload.access_token,refresh_token:payload.refresh_token,expires_in:payload.expires_in};
    }
  },

  async restoreSession() {
    const token=await restoreAccessToken();
    if(!token) return null;
    setAccessToken(token);
    try { return {token,user:await this.currentUser()}; }
    catch(error){ await this.signOut(); throw error; }
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
