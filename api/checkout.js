// Оформлення замовлення: спочатку ЗАВЖДИ пишемо в Supabase (джерело правди),
// і лише потім намагаємось синхронізувати з KeyCRM. Якщо KeyCRM недоступний —
// замовлення клієнта все одно збережено, помилка синхронізації логується для крон-повтору.
const { getSupabase } = require('../lib/supabase');
const { getSessionUser } = require('../lib/session');
const { syncOrderToKeyCRM } = require('../lib/keycrm');

// Розбирає id елемента кошика виду "<productId>_<weight>"
function parseCartItemId(id) {
  const s = String(id || '');
  const idx = s.lastIndexOf('_');
  if (idx === -1) return { productId: s, weight: null };
  return { productId: s.slice(0, idx), weight: s.slice(idx + 1) };
}

// Безпечно перетворює значення на ціле число (або null, якщо не вийшло)
function toIntOrNull(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не дозволено' });

  const {
    firstName, lastName, phone, email,
    petName, deliveryType, deliveryMethod,
    cityName, deliveryAddress, cityRef, branchRef, branchName,
    street, house, apartment,
    comment, callBeforeDelivery, payMethod, items,
  } = req.body || {};

  if (!phone || !items?.length) {
    return res.status(400).json({ error: 'phone та items обов’язкові' });
  }

  const totalAmount = items.reduce((sum, item) => sum + (item.price || 0) * (item.qty || 1), 0);

  const contactSnapshot = { firstName, lastName, phone, email, petName };
  const deliverySnapshot = {
    deliveryType, deliveryMethod, cityName, cityRef, branchRef, branchName,
    street, house, apartment, deliveryAddress, callBeforeDelivery,
  };

  const supabase = getSupabase();
  const session = await getSessionUser(req);
  let dbUser = null;
  if (session) {
    const { data } = await supabase.from('users').select('*').eq('id', session.userId).maybeSingle();
    dbUser = data || null;
  }

  let order;
  try {
    const { data: insertedOrder, error: orderErr } = await supabase
      .from('orders')
      .insert({
        user_id: dbUser ? dbUser.id : null,
        status: 'new',
        total_amount: totalAmount,
        currency: 'UAH',
        payment_method: payMethod,
        comment: comment || null,
        contact_snapshot: contactSnapshot,
        delivery_snapshot: deliverySnapshot,
        keycrm_sync_status: 'pending',
        keycrm_sync_attempts: 0,
      })
      .select()
      .single();
    if (orderErr) throw orderErr;
    order = insertedOrder;

    // Реальні назви колонок у order_items: product_name, weight (int), unit_price, quantity, image_url
    const orderItemsPayload = items.map((item) => {
      const parsed = parseCartItemId(item.id);
      return {
        order_id: order.id,
        product_id: toIntOrNull(parsed.productId),
        product_name: item.name,
        weight: toIntOrNull(item.weight != null ? item.weight : parsed.weight),
        quantity: item.qty || 1,
        unit_price: item.price || 0,
        image_url: item.img || null,
      };
    });

    const { error: itemsErr } = await supabase.from('order_items').insert(orderItemsPayload);
    if (itemsErr) throw itemsErr;

    if (dbUser) {
      await supabase.from('user_checkout_profile').upsert(
        {
          user_id: dbUser.id,
          first_name: firstName || null,
          last_name: lastName || null,
          phone: phone || null,
          email: email || null,
          pet_name: petName || null,
          delivery_method: deliveryMethod || null,
          city_name: cityName || null,
          city_ref: cityRef || null,
          branch_ref: branchRef || null,
          branch_name: branchName || null,
          street: street || null,
          house: house || null,
          apartment: apartment || null,
          pay_method: payMethod || null,
          call_before_delivery: !!callBeforeDelivery,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    }
  } catch (e) {
    return res.status(500).json({ error: 'Не вдалося зберегти замовлення', details: String(e.message || e) });
  }

  try {
    const orderItemsForSync = items.map((item) => ({ name: item.name, weight: item.weight, qty: item.qty, price: item.price }));
    const existingBuyerId = dbUser ? dbUser.keycrm_buyer_id : null;
    const syncResult = await syncOrderToKeyCRM(order, orderItemsForSync, existingBuyerId);
    await supabase.from('orders').update({
      keycrm_buyer_id: syncResult.buyerId,
      keycrm_order_id: syncResult.keycrmOrderId,
      keycrm_sync_status: 'synced',
      keycrm_sync_error: null,
    }).eq('id', order.id);
    if (dbUser && !syncResult.buyerReused) {
      await supabase.from('users').update({ keycrm_buyer_id: syncResult.buyerId }).eq('id', dbUser.id);
    }
  } catch (syncErr) {
    await supabase.from('orders').update({
      keycrm_sync_status: 'failed',
      keycrm_sync_error: String(syncErr.message || syncErr),
      keycrm_sync_attempts: 1,
    }).eq('id', order.id);
  }

  return res.status(200).json({ orderId: order.id });
};
