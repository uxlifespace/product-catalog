module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    firstName, lastName, phone, email,
    petName, deliveryType, deliveryAddress,
    comment, payMethod, items
  } = req.body || {};

  if (!phone || !items?.length) {
    return res.status(400).json({ error: 'phone and items are required' });
  }h

  const headers = {
    Authorization: `Bearer ${process.env.KEYCRM_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'Замовлення з сайту';

  try {
    // 1. Create buyer
    const buyerPayload = {
      full_name: fullName,
      phone: [phone],
    };
    if (email) buyerPayload.email = [email];

    const buyerRes = await fetch('https://openapi.keycrm.app/v1/buyer', {
      method: 'POST',
      headers,
      body: JSON.stringify(buyerPayload),
    });
    const buyer = await buyerRes.json();
    if (!buyerRes.ok) return res.status(502).json({ error: 'KeyCRM buyer error', details: buyer });

    // 2. Build order comment
    const commentParts = [];
    if (petName) commentParts.push(`Кличка: ${petName}`);
    if (deliveryAddress) commentParts.push(`Доставка: ${deliveryAddress}`);
    if (payMethod) commentParts.push(`Оплата: ${payMethod === 'cod' ? 'Накладений платіж' : payMethod === 'applegoogle' ? 'Apple/Google Pay' : 'Картка онлайн'}`);
    if (comment) commentParts.push(`Коментар: ${comment}`);
    const buyerComment = commentParts.join('\n');

    // 3. Build products array
    const products = items.map(item => ({
      name: `${item.name} ${item.weight}г`,
      quantity: item.qty || 1,
      price: item.price || 0,
      unit_type: 'шт',
    }));

    // 4. Create order
    const orderPayload = {
      source_name: 'Сайт',
      buyer: { id: buyer.id },
      buyer_comment: buyerComment,
      products,
    };

    const orderRes = await fetch('https://openapi.keycrm.app/v1/order', {
      method: 'POST',
      headers,
      body: JSON.stringify(orderPayload),
    });
    const order = await orderRes.json();
    if (!orderRes.ok) return res.status(502).json({ error: 'KeyCRM order error', details: order });

    return res.status(200).json({ buyer, order });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
