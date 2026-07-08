// Webhook від Monobank Acquiring (POST). Джерело правди про оплату — Supabase.
// Docs: https://api.monobank.ua/docs/acquiring.html
// Перевіряємо x-sign (ECDSA/SHA256 над сирими байтами тіла) публічним ключем з /api/merchant/pubkey.
const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { markOrderPaidInKeyCrm } = require('../lib/keycrm');

let cachedPubKey = null;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function getPubKey(token) {
  if (cachedPubKey) return cachedPubKey;
  const r = await fetch('https://api.monobank.ua/api/merchant/pubkey', {
    headers: { 'X-Token': token },
  });
  const data = await r.json();
  if (!r.ok || !data.key) throw new Error('Не вдалося отримати публічний ключ Monobank');
  cachedPubKey = Buffer.from(data.key, 'base64');
  return cachedPubKey;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.MONOBANK_TOKEN;
  if (!token) return res.status(500).json({ error: 'MONOBANK_TOKEN not configured' });

  const rawBody = await readRawBody(req);
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Невалідний JSON' });
  }

  try {
    const signature = req.headers['x-sign'];
    if (!signature) return res.status(400).json({ error: 'Відсутній x-sign' });

    const pubKey = await getPubKey(token);
    const verifier = crypto.createVerify('SHA256');
    verifier.update(rawBody);
    verifier.end();
    const isValid = verifier.verify(
      { key: pubKey, format: 'der', type: 'spki' },
      Buffer.from(signature, 'base64')
    );
    if (!isValid) {
      console.error('Monobank webhook: невалідний підпис');
      return res.status(200).json({ received: true }); // все одно 200, щоб Monobank не ретраїв нескінченно
    }
  } catch (e) {
    console.error('Monobank webhook: помилка перевірки підпису', e);
    return res.status(200).json({ received: true });
  }

  // reference у нас — це String(orderId) (Supabase UUID), як формує api/payment.js
  const orderId = payload.reference;
  const status = payload.status; // 'created' | 'processing' | 'success' | 'failure' | 'reversed' | 'expired'

  try {
    if (status === 'success' && orderId) {
      const supabase = getSupabase();
      const amount = (payload.amount || payload.modifiedAmount || 0) / 100;

      const { data: order, error: fetchErr } = await supabase
        .from('orders')
        .select('id, keycrm_order_id, payment_status')
        .eq('id', orderId)
        .maybeSingle();

      if (fetchErr || !order) {
        console.error('Monobank webhook: замовлення не знайдено в Supabase', orderId, fetchErr);
        return res.status(200).json({ received: true });
      }

      if (order.payment_status !== 'paid') {
        await supabase
          .from('orders')
          .update({
            payment_status: 'paid',
            paid_at: new Date().toISOString(),
            payment_provider: 'monobank',
            payment_provider_ref: payload.invoiceId || null,
          })
          .eq('id', orderId);

        // Якщо KeyCRM-замовлення вже існує (синхронізація пройшла раніше) — одразу позначаємо оплату там же.
        // Якщо ще ні — це підхопить api/cron/sync-keycrm.js окремим циклом після синхронізації.
        if (order.keycrm_order_id) {
          try {
            await markOrderPaidInKeyCrm(order.keycrm_order_id, amount);
            await supabase.from('orders').update({ keycrm_payment_synced: true }).eq('id', orderId);
          } catch (e) {
            console.error('Monobank webhook: не вдалося одразу позначити оплату в KeyCRM (підхопить cron)', e);
          }
        }
      }
    }
  } catch (e) {
    console.error('Monobank webhook: помилка обробки', e);
  }

  // Monobank очікує 200 OK без спеціального тіла — інакше ретраїть до 3 разів.
  return res.status(200).json({ received: true });
};
