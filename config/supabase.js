const { createClient } = require('@supabase/supabase-js');

// Extract the API URL from the database URL if it includes credentials
let supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// If the URL includes credentials (postgresql://), extract the API URL
if (supabaseUrl && supabaseUrl.startsWith('postgresql://')) {
  // Extract the host from the postgres URL and construct the API URL
  const match = supabaseUrl.match(/postgresql:\/\/[^:]+:[^@]+@([^\/]+)\/(.+)/);
  if (match) {
    const host = match[1];
    const projectRef = match[2];
    supabaseUrl = `https://${projectRef}.supabase.co`;
  }
}

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase configuration. Please check your environment variables.');
}

// Admin client for scheduler operations (uses service role key)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

module.exports = {
  supabaseAdmin
};
