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

// NP occasionally returns an empty/short result on an otherwise-valid request (its own
// rate-limiting, not something we control). Retry the same call a couple of times with a
// short delay before treating "empty" as a real answer.
async function npCallWithRetry(modelName, calledMethod, methodProperties, attempts) {
  attempts = attempts || 3;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await npCall(modelName, calledMethod, methodProperties);
    const d = last && last.data;
    const empty = !d || (Array.isArray(d) ? d.length === 0 : (Array.isArray(d[0] && d[0].Addresses) && d[0].Addresses.length === 0));
    if (!empty) return last;
    if (i < attempts - 1) await new Promise(function(resolve){ setTimeout(resolve, 350); });
  }
  return last;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, query, cityRef, settlementRef, category } = req.body || {};

  try {
    if (action === 'searchCity') {
      const data = await npCallWithRetry('AddressGeneral', 'searchSettlements', {
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

      async function fetchPage(page, attempts) {
        const data = await npCallWithRetry('AddressGeneral', 'getWarehouses', { ...baseProps, Limit: 100, Page: page }, attempts);
        const items = data.data || [];
        const totalRaw = data.info?.totalCount ?? data.info?.total_count ?? null;
        return { items, total: totalRaw ? Number(totalRaw) : null };
      }

      // Page 1 gets extra retry attempts — it's the page every request depends on, and an
      // empty page 1 previously meant the whole dropdown looked broken to the user.
      const first = await fetchPage(1, 4);

      if (!category) {
        return res.status(200).json({ data: first.items });
      }

      // NP's getWarehouses does NOT accept "CategoryOfWarehouse" as a request filter (sending it
      // silently returns an empty result). Each warehouse object DOES carry this field in the
      // response, so filter after fetching instead. Big cities list branches first, so for an
      // empty/short query we may need to scan several extra pages before postomats show up.
      let matches = first.items.filter(w => w.CategoryOfWarehouse === category);
      const totalPages = first.total ? Math.ceil(first.total / 100) : 12;
      const maxPages = Math.min(Math.max(totalPages, 1), 15);
      let page = 2;
      let emptyStreak = 0;
      while (matches.length < 20 && page <= maxPages && emptyStreak < 2) {
        const next = await fetchPage(page, 3);
        if (next.items.length === 0) {
          emptyStreak++;
        } else {
          emptyStreak = 0;
        }
        matches = matches.concat(next.items.filter(w => w.CategoryOfWarehouse === category));
        page++;
      }
      return res.status(200).json({ data: matches.slice(0, 100) });
    }

    if (action === 'searchStreet') {
      const data = await npCallWithRetry('Address', 'searchSettlementStreets', {
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
