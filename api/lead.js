export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const headers = {
    Authorization: `Bearer ${process.env.KEYCRM_API_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const buyerRes = await fetch('https://openapi.keycrm.app/v1/buyer', {
      method: 'POST',
      headers,
      body: JSON.stringify({ full_name: 'Заявка з лендінгу', phone: [phone] }),
    });
    const buyer = await buyerRes.json();
    console.log('Buyer:', buyerRes.status, JSON.stringify(buyer));
    if (!buyerRes.ok) return res.status(502).json(buyer);

    const orderRes = await fetch('https://openapi.keycrm.app/v1/order', {
      method: 'POST',
      headers,
      body: JSON.stringify({ buyer_id: buyer.id, buyer_comment: 'Телефон: ' + phone, status_id: 1 }),
    });
    const order = await orderRes.json();
    console.log('Order:', orderRes.status, JSON.stringify(order));

    return res.status(200).json({ buyer, order });
  } catch (e) {
    console.error('KeyCRM error:', String(e));
    return res.status(500).json({ error: String(e) });
  }
}
