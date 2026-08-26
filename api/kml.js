// 구글 My Maps KML 중계
// 브라우저에서 google.com 의 KML 을 직접 fetch 하면 CORS 로 막히기 때문에
// 같은 도메인의 이 함수를 거쳐서 받아온다. (공개 CORS 프록시 대체)
//
// 보안: 임의 주소를 대신 호출해 주는 열린 프록시가 되지 않도록
//       구글 My Maps 의 KML 주소로만 요청을 만든다.

const ALLOWED_HOSTS = new Set(['www.google.com', 'google.com', 'maps.google.com']);
const MID_RE = /^[A-Za-z0-9_.-]+$/;

// 입력(mid 또는 공유 URL)에서 안전한 KML 주소를 만든다. 불가하면 null.
function buildKmlUrl(raw) {
  // mid 값만 넘어온 경우
  if (MID_RE.test(raw) && !raw.includes('/')) {
    return `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(raw)}&forcekml=1`;
  }
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!ALLOWED_HOSTS.has(u.hostname)) return null;
  if (!u.pathname.startsWith('/maps/d/')) return null;
  const mid = u.searchParams.get('mid');
  if (!mid || !MID_RE.test(mid)) return null;
  return `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`;
}

export default async function handler(req, res) {
  const raw = String(req.query.url || req.query.mid || '').trim();
  if (!raw) {
    res.status(400).json({ error: 'url 또는 mid 파라미터가 필요합니다' });
    return;
  }

  const target = buildKmlUrl(raw);
  if (!target) {
    res.status(400).json({
      error: '구글 My Maps 주소만 사용할 수 있습니다. (예: https://www.google.com/maps/d/edit?mid=...)',
    });
    return;
  }

  try {
    const r = await fetch(target, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; travel-planner/1.0)' },
    });

    if (!r.ok) {
      res.status(502).json({
        error:
          r.status === 404
            ? '지도를 찾을 수 없습니다. mid 값과 지도 공개 설정을 확인해 주세요.'
            : `구글에서 KML 을 받지 못했습니다 (HTTP ${r.status})`,
      });
      return;
    }

    const body = Buffer.from(await r.arrayBuffer());

    // 비공개 지도는 KML 대신 로그인 페이지(HTML)를 돌려준다
    const head = body.slice(0, 400).toString('utf8').trim();
    if (!head.includes('<kml') && !head.startsWith('<?xml')) {
      res.status(403).json({
        error: 'KML 이 아닌 응답을 받았습니다. 지도를 "링크가 있는 모든 사용자"로 공개했는지 확인해 주세요.',
      });
      return;
    }

    res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).send(body);
  } catch (e) {
    res.status(500).json({ error: 'KML 요청에 실패했습니다' });
  }
}
