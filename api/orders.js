// Історія замовлень залогіненого користувача (найновіші — першими).
// Вимагає активної сесії (401, якщо гість) — на відміну від /api/me, який завжди 200.
const { getSupabase } = require('../lib/supabase');
const { getSessionUser } = require('../lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Метод не дозволено' });

  const session = await getSessionUser(req);
  if (!session) {
    return res.status(401).json({ error: 'Потрібна автентифікація' });
  }

  try {
    const supabase = getSupabase();

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, status, total_amount, currency, created_at, keycrm_order_id, order_items(*)')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({ orders: orders || [] });
  } catch (e) {
    return res.status(500).json({ error: 'Помилка БД', details: String(e.message || e) });
  }
};
