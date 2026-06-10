export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'phone is required' });

  try {
        const r = await fetch('https://openapi.keycrm.app/v1/buyers', {
                method: 'POST',
                headers: {
                          Authorization: `Bearer ${process.env.KEYCRM_API_KEY}`,
                          'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                          full_name: 'Заявка з лендінгу',
                          phone,
                }),
        });
        const data = await r.json();
        console.log('KeyCRM response:', r.status, JSON.stringify(data));
        return res.status(r.ok ? 200 : 502).json(data);
  } catch (e) {
        console.error('KeyCRM error:', String(e));
        return res.status(500).json({ error: String(e) });
  }
}
