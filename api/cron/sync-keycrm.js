// Vercel Cron: періодично повторює спроби синхронізації замовлень із KeyCRM,
// якщо попередня спроба під час чекауту не вдалася (мережа, ліміти KeyCRM тощо).
// Захищено CRON_SECRET (якщо заданий) — щоб цей ендпоінт не міг викликати хтось інший.
const { getSupabase } = require('../../lib/supabase');
const { syncOrderToKeyCRM } = require('../../lib/keycrm');

module.exports = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Не авторизовано' });
    }
  }

  try {
    const supabase = getSupabase();

    const { data: orders, error } = await supabase
      .from('orders')
      .select('*, order_items(*), users(keycrm_buyer_id)')
      .in('keycrm_sync_status', ['pending', 'failed'])
      .lt('keycrm_sync_attempts', 5)
      .limit(20);

    if (error) throw error;

    const results = [];

    for (const order of orders || []) {
      const items = order.order_items || [];
      const existingBuyerId = order.keycrm_buyer_id || order.users?.keycrm_buyer_id || null;

      try {
        const syncResult = await syncOrderToKeyCRM(order, items, existingBuyerId);

        await supabase
          .from('orders')
          .update({
            keycrm_buyer_id: syncResult.buyerId,
            keycrm_order_id: syncResult.keycrmOrderId,
            keycrm_sync_status: 'synced',
            keycrm_sync_error: null,
          })
          .eq('id', order.id);

        if (!syncResult.buyerReused) {
          await supabase
            .from('users')
            .update({ keycrm_buyer_id: syncResult.buyerId })
            .eq('id', order.user_id);
        }

        results.push({ orderId: order.id, status: 'synced' });
      } catch (syncErr) {
        await supabase
          .from('orders')
          .update({
            keycrm_sync_status: 'failed',
            keycrm_sync_error: String(syncErr.message || syncErr),
            keycrm_sync_attempts: (order.keycrm_sync_attempts || 0) + 1,
          })
          .eq('id', order.id);

        results.push({ orderId: order.id, status: 'failed', error: String(syncErr.message || syncErr) });
      }
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (e) {
    return res.status(500).json({ error: 'Помилка cron-синхронізації', details: String(e.message || e) });
  }
};
