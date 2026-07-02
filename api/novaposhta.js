const NP_API = 'https://api.novaposhta.ua/v2.0/json/';
const NP_KEY = process.env.NOVAPOSHTA_API_KEY || '';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, query, cityRef, category } = req.body || {};

  try {
    if (action === 'searchCity') {
      const payload = {
        apiKey: NP_KEY,
        modelName: 'AddressGeneral',
        calledMethod: 'searchSettlements',
        methodProperties: {
          CityName: query || '',
          Limit: 10,
          Page: 1,
        },
      };
      const r = await fetch(NP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      // Flatten: data.data[0].Addresses
      const addresses = data.data?.[0]?.Addresses || [];
      return res.status(200).json({ data: addresses });
    }

    if (action === 'searchBranch') {
      const methodProperties = {
        CityRef: cityRef || '',
        FindByString: query || '',
        Limit: 100,
        Page: 1,
        Language: 'UA',
      };
      // category: 'Branch' (відділення) або 'Postomat' (поштомат) — фільтр на рівні NP API
      if (category) methodProperties.CategoryOfWarehouse = category === 'Postomat' ? 'Postomat' : 'Branch';
      const payload = {
        apiKey: NP_KEY,
        modelName: 'AddressGeneral',
        calledMethod: 'getWarehouses',
        methodProperties,
      };
      const r = await fetch(NP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      return res.status(200).json({ data: data.data || [] });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
