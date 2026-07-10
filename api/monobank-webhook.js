// Monobank Acquiring — webHookUrl callback. Джерело істини про статус оплати.
// Приходить POST (JSON) при кожній зміні статусу рахунку; заголовок x-sign містить
// ECDSA-підпис RAW-тіла запиту — перевіряємо публічним ключем з /api/merchant/pubkey.
// Якщо не відповісти 200 OK — Monobank повторить запит до 3 разів.
// Docs: https://monobank.ua/api-docs/acquiring/dev/webhooks/verify

const crypto = require('crypto');

// Читаємо RAW тіло запиту самі (до будь-якого автопарсингу) — підпис рахується
// саме над точними байтами, які прийшли, а не над повторно серіалізованим JSON.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

let cachedPubKey = null;

async function getPubKey(token) {
  if (cachedPubKey) return cachedPubKey;
  const r = await fetch('https://api.monobank.ua/api/merchant/pubkey', {
    headers: { 'X-Token': token },
  });
  const data = await r.json();
  if (!r.ok || !data.key) throw new Error('Не вдалося отримати публічний ключ Monobank');
  cachedPubKey = Buffer.from(data.key, 'base64'); // base64(PEM)
  return cachedPubKey;
}

function parseOrderId(reference) {
  const m = /^MO(\d+)-/.exec(reference || '');
  return m ? m[1] : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.MONOBANK_TOKEN;
  if (!token) return res.status(500).json({ error: 'MONOBANK_TOKEN not configured' });

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Cannot read body' });
  }

  const xSign = req.headers['x-sign'];
  if (!xSign) return res.status(400).json({ error: 'x-sign header missing' });

  try {
    const pubKey = await getPubKey(token);
    const verify = crypto.createVerify('SHA256');
    verify.write(rawBody);
    verify.end();
    const valid = verify.verify(pubKey, Buffer.from(xSign, 'base64'));
    if (!valid) {
      console.error('Monobank webhook: invalid x-sign');
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } catch (e) {
    console.error('Monobank webhook: signature check failed', String(e));
    return res.status(400).json({ error: 'Signature check failed' });
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { reference, status, amount, invoiceId } = body;
  const orderId = parseOrderId(reference);

  if (orderId && status === 'success') {
    try {
      const headers = {
        Authorization: `Bearer ${process.env.KEYCRM_API_KEY}`,
        'Content-Type': 'application/json',
      };
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const paymentDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const paymentRes = await fetch(`https://openapi.keycrm.app/v1/order/${orderId}/payment`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          payment_method: 'Monobank',
          amount: (Number(amount) || 0) / 100, // з копійок у гривні
          status: 'paid',
          description: `Monobank invoice ${invoiceId || ''} (${reference})`,
          payment_date: paymentDate,
        }),
      });

      if (!paymentRes.ok) {
        const details = await paymentRes.json().catch(() => ({}));
        console.error('KeyCRM payment create failed', { orderId, details });
      }
    } catch (e) {
      console.error('KeyCRM payment create error', String(e));
    }
  } else if (orderId) {
    console.log('Monobank webhook: non-success status', { orderId, status });
  }

  // Monobank очікує лише HTTP 200 OK, без спеціального тіла відповіді
  return res.status(200).json({ received: true });
};
