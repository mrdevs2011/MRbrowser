module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  var url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  var anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
  if (!url || !anonKey) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: 'missing_env', message: 'Set SUPABASE_URL and SUPABASE_ANON_KEY on Vercel' }));
  }
  res.statusCode = 200;
  return res.end(JSON.stringify({ url: url, anonKey: anonKey }));
};
