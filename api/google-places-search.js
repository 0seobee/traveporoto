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
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&language=ko&key=${key}`
    );
    const data = await r.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: 'google places request failed' });
  }
}
