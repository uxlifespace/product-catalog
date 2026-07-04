// Виходить із системи — просто очищає кукі сесії.
const { clearSessionCookie } = require('../../lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не дозволено' });
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
};
