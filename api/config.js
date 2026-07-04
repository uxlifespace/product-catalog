// Публічний (не секретний) конфіг для фронтенду — щоб не хардкодити Google Client ID в HTML.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
};
