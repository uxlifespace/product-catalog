// Клієнт Supabase (singleton) для серверних API-функцій.
// Використовує SUPABASE_URL та SUPABASE_SERVICE_ROLE_KEY (service_role, тільки на сервері!).
const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не налаштовані');
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

module.exports = { getSupabase };
