const NP_API = 'https://api.novaposhta.ua/v2.0/json/';
const NP_KEY = process.env.NOVAPOSHTA_API_KEY || '';

async function npCall(modelName, calledMethod, methodProperties) {
  const r = await fetch(NP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: NP_KEY, modelName, calledMethod, methodProperties }),
  });
  return r.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, query, cityRef, settlementRef, category } = req.body || {};

  try {
    if (action === 'searchCity') {
      const data = await npCall('AddressGeneral', 'searchSettlements', {
        CityName: query || '',
        Limit: 10,
        Page: 1,
      });
      // Flatten: data.data[0].Addresses
      const addresses = data.data?.[0]?.Addresses || [];
      return res.status(200).json({ data: addresses });
    }

    if (action === 'searchBranch') {
      const baseProps = { CityRef: cityRef || '', FindByString: query || '', Language: 'UA' };

      async function fetchPage(page) {
        const data = await npCall('AddressGeneral', 'getWarehouses', { ...baseProps, Limit: 100, Page: page });
        return data.data || [];
      }

      let page1 = await fetchPage(1);

      if (!category) {
        return res.status(200).json({ data: page1 });
      }

      // NP's getWarehouses does NOT accept "CategoryOfWarehouse" as a request filter (sending it
      // silently returns an empty result). Each warehouse object DOES carry this field in the
      // response, so filter after fetching instead. Big cities list branches first, so for an
      // empty/short query we may need to scan a few extra pages before postomats show up.
      let all = page1;
      let matches = all.filter(w => w.CategoryOfWarehouse === category);
      let page = 2;
      while (matches.length < 20 && page <= 6 && all.length === 100) {
        all = await fetchPage(page);
        matches = matches.concat(all.filter(w => w.CategoryOfWarehouse === category));
        page++;
        if (all.length < 100) break;
      }
      return res.status(200).json({ data: matches.slice(0, 100) });
    }

    if (action === 'searchStreet') {
      const data = await npCall('Address', 'searchSettlementStreets', {
        StreetName: query || '',
        SettlementRef: settlementRef || '',
        Limit: 20,
      });
      // Response shape mirrors searchSettlements (data.data[0].Addresses) on some API versions,
      // flat data.data array on others — handle both defensively.
      const streets = data.data?.[0]?.Addresses || (Array.isArray(data.data) ? data.data : []) || [];
      return res.status(200).json({ data: streets });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
