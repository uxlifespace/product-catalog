// Повертає поточного користувача (якщо залогінений) та профіль чекауту для автозаповнення.
// Ніколи не повертає 401 — для гостя просто { user: null, profile: null }.
const { getSupabase } = require('../lib/supabase');
const { getSessionUser } = require('../lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Метод не дозволено' });

  const session = await getSessionUser(req);
  if (!session) {
    return res.status(200).json({ user: null, profile: null });
  }

  try {
    const supabase = getSupabase();

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.userId)
      .maybeSingle();
    if (userErr) throw userErr;

    if (!user) {
      return res.status(200).json({ user: null, profile: null });
    }

    const { data: profile, error: profileErr } = await supabase
      .from('user_checkout_profile')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileErr) throw profileErr;

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
      },
      profile: profile || null,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Помилка БД', details: String(e.message || e) });
  }
};
