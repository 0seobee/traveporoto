export default async function handler(req, res) {
  const q = req.query.q;
  if (!q) {
    res.status(400).json({ error: 'q parameter required' });
    return;
  }
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) {
    res.status(500).json({ error: 'GOOGLE_PLACES_KEY not configured' });
    return;
  }
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({ textQuery: q, languageCode: 'ko' }),
    });
    const data = await r.json();
    res.status(r.ok ? 200 : 500).json(data);
  } catch (e) {
    res.status(500).json({ error: 'google places request failed' });
  }
}
