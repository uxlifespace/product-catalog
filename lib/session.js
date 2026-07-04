// Допоміжні функції для сесії користувача через підписаний JWT у httpOnly-кукі.
// Кука "mc_session" підписується/перевіряється бібліотекою jose (HS256) через SESSION_SECRET.
// Ніякої таблиці сесій не потрібно — сесія повністю "stateless".
const { SignJWT, jwtVerify } = require('jose');

const COOKIE_NAME = 'mc_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 днів

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET не налаштовано');
  return new TextEncoder().encode(secret);
}

async function createSessionToken(user) {
  return await new SignJWT({
    email: user.email,
    name: user.name || '',
    avatar_url: user.avatar_url || '',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

async function verifySessionToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      avatar_url: payload.avatar_url,
    };
  } catch (e) {
    return null;
  }
}

// Розбирає заголовок Cookie у звичайний об'єкт { ім'я: значення }
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function setSessionCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// Повертає сесію користувача з куки або null, якщо не залогінений.
// НІКОЛИ не кидає помилку — гостьовий чекаут має продовжувати працювати.
async function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return await verifySessionToken(token);
}

module.exports = {
  createSessionToken,
  verifySessionToken,
  getSessionUser,
  setSessionCookie,
  clearSessionCookie,
  COOKIE_NAME,
};
