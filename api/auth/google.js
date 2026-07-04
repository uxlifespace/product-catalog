// Перевіряє ID-токен від Google Identity Services (GIS) через JWKS Google,
// створює/оновлює користувача в Supabase за google_sub і видає кукі-сесію.
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { getSupabase } = require('../../lib/supabase');
const { createSessionToken, setSessionCookie } = require('../../lib/session');

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не дозволено' });

  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Потрібен credential' });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID не налаштовано' });

  let payload;
  try {
    const result = await jwtVerify(credential, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
    });
    payload = result.payload;
  } catch (e) {
    return res.status(401).json({ error: 'Недійсний токен Google' });
  }

  const googleSub = payload.sub;
  const email = payload.email;
  const name = payload.name || '';
  const avatarUrl = payload.picture || '';

  if (!googleSub || !email) {
    return res.status(400).json({ error: 'Неповний профіль Google' });
  }

  try {
    const supabase = getSupabase();

    // Шукаємо існуючого користувача за google_sub
    const { data: existing, error: findErr } = await supabase
      .from('users')
      .select('*')
      .eq('google_sub', googleSub)
      .maybeSingle();
    if (findErr) throw findErr;

    let user;
    if (existing) {
      const { data, error } = await supabase
        .from('users')
        .update({ email, name, avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      user = data;
    } else {
      const { data, error } = await supabase
        .from('users')
        .insert({ google_sub: googleSub, email, name, avatar_url: avatarUrl })
        .select()
        .single();
      if (error) throw error;
      user = data;
    }

    const token = await createSessionToken(user);
    setSessionCookie(res, token);

    return res.status(200).json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Помилка БД', details: String(e.message || e) });
  }
};
