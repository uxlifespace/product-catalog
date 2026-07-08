// Monobank Acquiring API
// Docs: https://api.monobank.ua/docs/acquiring.html
// Token: MONOBANK_TOKEN env variable (merchant token from portal.monobank.ua)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { orderId, items } = req.body || {};

  if (!orderId || !items?.length) {
    return res.status(400).json({ error: 'orderId та items обов’язкові' });
  }

  const token = process.env.MONOBANK_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MONOBANK_TOKEN not configured' });
  }

  // Суму рахуємо на сервері з items — клієнтському amount не довіряємо.
  const amount = items.reduce((sum, item) => sum + (item.price || 0) * (item.qty || 1), 0);
  if (!(amount > 0)) {
    return res.status(400).json({ error: 'Некоректна сума замовлення' });
  }

  // Monobank amount is in kopecks (UAH * 100)
  const amountKopecks = Math.round(amount * 100);

  // Redirect URL after payment
  const baseUrl = process.env.SITE_URL || 'https://product-catalog-plum.vercel.app';
  const redirectUrl = `${baseUrl}/checkout.html?success=1`;
  const webHookUrl = `${baseUrl}/api/payment-webhook`;

  const basketOrder = (items || []).map((item) => ({
    name: `${item.name} ${item.weight}г`,
    qty: item.qty || 1,
    sum: Math.round((item.price || 0) * 100), // price per unit in kopecks
    icon: '',
    unit: 'шт',
    code: String(item.id || ''),
  }));

  const payload = {
    amount: amountKopecks,
    ccy: 980, // UAH
    merchantPaymInfo: {
      reference: String(orderId),
      destination: `Замовлення Marcel&Co #${orderId}`,
      basketOrder,
    },
    redirectUrl,
    webHookUrl,
    validity: 3600, // seconds, link is valid for 1 hour
    paymentType: 'debit',
  };

  try {
    const r = await fetch('https://api.monobank.ua/api/merchant/invoice/create', {
      method: 'POST',
      headers: {
        'X-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();

    if (!r.ok) {
      console.error('Monobank error:', JSON.stringify(data));
      return res.status(502).json({ error: data.errText || 'Monobank error', code: data.errCode });
    }

    // data.invoiceId, data.pageUrl
    return res.status(200).json({
      invoiceId: data.invoiceId,
      pageUrl: data.pageUrl,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
