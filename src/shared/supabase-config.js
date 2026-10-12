'use strict';
/**
 * Supabase sozlamalari — faqat Vercel /api/config dan olinadi.
 * Lokalda kalit yo'q.
 */
const DEFAULT_CONFIG_URL = 'https://mrbrowser-one.vercel.app/api/config';

let cache = null;
let loading = null;

function configEndpoint() {
  return (
    process.env.MRBROWSER_CONFIG_URL ||
    process.env.VERCEL_CONFIG_URL ||
    DEFAULT_CONFIG_URL
  );
}

async function loadConfig() {
  if (cache && cache.url && cache.anonKey) return cache;
  if (loading) return loading;

  loading = (async () => {
    const endpoint = configEndpoint();
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('config_http_' + res.status + (t ? ': ' + t.slice(0, 120) : ''));
    }
    const data = await res.json();
    if (!data || !data.url || !data.anonKey) {
      throw new Error('config_invalid');
    }
    cache = { url: String(data.url), anonKey: String(data.anonKey) };
    return cache;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

function getCached() {
  return cache;
}

module.exports = {
  loadConfig,
  getCached,
  configEndpoint,
};
