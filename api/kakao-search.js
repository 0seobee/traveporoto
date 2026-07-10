export default async function handler(req, res) {
  const q = req.query.q;
  if (!q) {
    res.status(400).json({ error: 'q parameter required' });
    return;
  }
  const key = process.env.KAKAO_REST_KEY;
  if (!key) {
    res.status(500).json({ error: 'KAKAO_REST_KEY not configured' });
    return;
  }
  try {
    const r = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=6`,
      { headers: { Authorization: `KakaoAK ${key}` } }
    );
    const data = await r.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: 'kakao request failed' });
  }
}
