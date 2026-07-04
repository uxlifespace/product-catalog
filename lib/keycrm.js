// Допоміжні функції для синхронізації замовлень із KeyCRM.
// Supabase — джерело правди (SSOT); ці функції викликаються ПІСЛЯ успішного запису в Supabase
// і НЕ повинні блокувати чекаут клієнта, якщо KeyCRM недоступний.
const KEYCRM_BASE = 'https://openapi.keycrm.app/v1';

function headers() {
  return {
    Authorization: `Bearer ${process.env.KEYCRM_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Створює покупця в KeyCRM АБО повертає вже наявний keycrm_buyer_id.
// Це виправляє баг "дублікатів лідів" — раніше кожен чекаут створював нового покупця.
async function ensureBuyer({ existingBuyerId, fullName, phone, email, petName }) {
  if (existingBuyerId) {
    return { id: existingBuyerId, reused: true };
  }

  const payload = { full_name: fullName, phone: [phone] };
  if (email) payload.email = [email];
  if (petName) payload.custom_fields = [{ uuid: 'CT_1001', value: petName }];

  const r = await fetch(`${KEYCRM_BASE}/buyer`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) {
    const err = new Error('Помилка створення покупця в KeyCRM: ' + JSON.stringify(data));
    err.details = data;
    throw err;
  }
  return { id: data.id, reused: false, raw: data };
}

// Формує блок доставки для замовлення KeyCRM (Нова Пошта: відділення/поштомат/кур'єр).
function buildShipping({ deliveryMethod, cityName, fullName, phone, street, house, apartment, branchRef, deliveryAddress }) {
  const shipping = { shipping_service: 'Нова Пошта' };
  if (cityName) shipping.shipping_address_city = cityName;
  if (fullName) shipping.recipient_full_name = fullName;
  if (phone) shipping.recipient_phone = phone;

  if (deliveryMethod === 'courier') {
    const line2 = [street, house].filter(Boolean).join(', ') + (apartment ? `, кв./оф. ${apartment}` : '');
    if (line2) shipping.shipping_secondary_line = line2;
  } else {
    if (branchRef) shipping.warehouse_ref = branchRef;
    if (deliveryAddress) shipping.shipping_receive_point = deliveryAddress;
  }
  return shipping;
}

async function createKeyCrmOrder({ buyerId, buyerComment, items, shipping }) {
  const products = (items || []).map((item) => ({
    name: `${item.name} ${item.weight}г`,
    quantity: item.qty || 1,
    price: item.price || 0,
    unit_type: 'шт',
  }));

  const payload = {
    source_name: 'Сайт',
    buyer: { id: buyerId },
    buyer_comment: buyerComment,
    products,
    shipping,
  };

  const r = await fetch(`${KEYCRM_BASE}/order`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) {
    const err = new Error('Помилка створення замовлення в KeyCRM: ' + JSON.stringify(data));
    err.details = data;
    throw err;
  }
  return data;
}

function paymentLabel(payMethod) {
  if (payMethod === 'cod') return 'Накладений платіж';
  if (payMethod === 'applegoogle') return 'Apple/Google Pay';
  return 'Картка онлайн';
}

// Головна функція: бере запис orders (уже збережений у Supabase) + позиції + відомий buyer_id
// (якщо клієнт вже синхронізувався раніше) і виконує повний цикл синхронізації з KeyCRM.
async function syncOrderToKeyCRM(order, items, existingBuyerId) {
  const contact = order.contact_snapshot || {};
  const delivery = order.delivery_snapshot || {};

  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Замовлення з сайту';

  const buyerResult = await ensureBuyer({
    existingBuyerId,
    fullName,
    phone: contact.phone,
    email: contact.email,
    petName: contact.petName,
  });

  const shipping = buildShipping({
    deliveryMethod: delivery.deliveryMethod,
    cityName: delivery.cityName,
    fullName,
    phone: contact.phone,
    street: delivery.street,
    house: delivery.house,
    apartment: delivery.apartment,
    branchRef: delivery.branchRef,
    deliveryAddress: delivery.deliveryAddress,
  });

  const commentParts = [];
  if (contact.petName) commentParts.push(`Кличка: ${contact.petName}`);
  if (delivery.branchName) commentParts.push(`Відділення: ${delivery.branchName}`);
  if (order.pay_method) commentParts.push(`Оплата: ${paymentLabel(order.pay_method)}`);
  if (order.comment) commentParts.push(`Коментар: ${order.comment}`);

  const keycrmOrder = await createKeyCrmOrder({
    buyerId: buyerResult.id,
    buyerComment: commentParts.join('\n'),
    items,
    shipping,
  });

  return {
    buyerId: buyerResult.id,
    buyerReused: buyerResult.reused,
    keycrmOrderId: keycrmOrder.id,
    raw: keycrmOrder,
  };
}

module.exports = { ensureBuyer, buildShipping, createKeyCrmOrder, syncOrderToKeyCRM, paymentLabel };
