// Monobank Acquiring — створення рахунку на оплату (redirect на pageUrl)
// Docs: https://monobank.ua/api-docs/acquiring/methods/ia/post--api--merchant--invoice--create
// Env: MONOBANK_TOKEN (мерчант-токен з portal.monobank.ua), SITE_URL

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.MONOBANK_TOKEN;
  const siteUrl = process.env.SITE_URL || 'https://marcelco.com.ua';

  if (!token) return res.status(500).json({ error: 'MONOBANK_TOKEN not configured' });

  const { orderId, items } = req.body || {};

  if (!orderId) return res.status(400).json({ error: 'orderId is required' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items is required' });

  // Рахуємо суму й кошик з нуля на сервері — не довіряємо клієнтському amount
  const basketOrder = items.map(item => {
    const qty = Number(item.qty) || 1;
    const price = Number(item.price) || 0;
    return {
      name: `${item.name} ${item.weight ? item.weight + 'г' : ''}`.trim(),
      qty,
      sum: Math.round(price * 100), // копійки за одиницю
      icon: '',
      unit: 'шт',
      code: String(item.id || ''),
    };
  });
  const amountKopecks = basketOrder.reduce((sum, i) => sum + i.sum * i.qty, 0);

  if (!amountKopecks || amountKopecks <= 0) {
    return res.status(400).json({ error: 'Order amount must be greater than 0' });
  }

  const reference = `MO${orderId}-${Date.now()}`;

  const payload = {
    amount: amountKopecks,
    ccy: 980, // UAH
    merchantPaymInfo: {
      reference,
      destination: `Замовлення Marcel&Co #${orderId}`,
      basketOrder,
    },
    redirectUrl: `${siteUrl}/checkout.html?success=1`,
    webHookUrl: `${siteUrl}/api/monobank-webhook`,
    validity: 3600, // секунд, посилання дійсне 1 годину
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
      console.error('Monobank invoice error:', JSON.stringify(data));
      return res.status(502).json({ error: data.errText || 'Monobank error', code: data.errCode });
    }

    return res.status(200).json({
      invoiceId: data.invoiceId,
      pageUrl: data.pageUrl,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
