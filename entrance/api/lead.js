// Serverless function (Vercel-style): receives a phone number from the
// landing page and creates a lead card in a KeyCRM pipeline.
// The API key lives ONLY in environment variables — never in client code.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  try {
    const r = await fetch('https://openapi.keycrm.app/v1/pipelines/cards', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KEYCRM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Заявка з лендингу Entrance',
        pipeline_id: Number(process.env.KEYCRM_PIPELINE_ID || 1),
        contact: { full_name: 'Заявка з сайту', phone },
      }),
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : 502).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
