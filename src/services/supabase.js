import { createClient } from '@supabase/supabase-js';
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Supabase environment variables are missing.');
export const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } });
