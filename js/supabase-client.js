import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://wfqcygkgshoyvdgsbnqr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_C8ClLruKmK3e7iKVdXrCyg_qK-zdW4D';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);