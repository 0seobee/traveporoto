export default async function handler(req, res) {
  const { originLat, originLng, destLat, destLng } = req.query;
  if (!originLat || !originLng || !destLat || !destLng) {
    res.status(400).json({ error: 'originLat, originLng, destLat, destLng required' });
    return;
  }
  const key = process.env.BUSMAPS_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'BUSMAPS_API_KEY not configured' });
    return;
  }
  try {
    const url = `https://capi.busmaps.com:8443/routes?origin=${originLat},${originLng}&destination=${destLat},${destLng}`;
    const r = await fetch(url, {
      headers: {
        'capi-key': `Bearer ${key}`,
        'capi-host': 'busmaps.com',
      },
    });
    const data = await r.json();
    res.status(r.ok ? 200 : 500).json(data);
  } catch (e) {
    res.status(500).json({ error: 'busmaps request failed' });
  }
}
