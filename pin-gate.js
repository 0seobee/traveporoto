(function () {
  const SB_URL = 'https://ciljiutblgbnwlgcdiyq.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpbGppdXRibGdibndsZ2NkaXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Mzg5MDksImV4cCI6MjA5ODAxNDkwOX0.fjjZDzV-RziE_tYlHQrZjIMHQhxipPyy6YQVRqw381Q';
  const SB_H = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
  const DEFAULT_PIN = '2236';

  const scriptEl = document.currentScript;
  let pageKey = scriptEl?.dataset.pageKey || '';
  if (pageKey === 'auto') {
    pageKey = new URLSearchParams(location.search).get('project') || 'default';
  }
  if (!pageKey) return;

  const UNLOCK_KEY = 'unlock_' + pageKey;

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function fetchHash() {
    const r = await fetch(`${SB_URL}/rest/v1/page_locks?page_key=eq.${encodeURIComponent(pageKey)}&select=pin_hash`, { headers: SB_H });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows[0]?.pin_hash || null;
  }

  async function bootstrapHash() {
    const hash = await sha256Hex(DEFAULT_PIN);
    await fetch(`${SB_URL}/rest/v1/page_locks`, {
      method: 'POST',
      headers: { ...SB_H, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ page_key: pageKey, pin_hash: hash })
    });
    return hash;
  }

  async function saveHash(hash) {
    await fetch(`${SB_URL}/rest/v1/page_locks`, {
      method: 'POST',
      headers: { ...SB_H, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ page_key: pageKey, pin_hash: hash })
    });
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
      #pinGateOverlay{position:fixed;inset:0;z-index:99999;background:#0d0f1a;display:flex;align-items:center;justify-content:center;font-family:'Apple SD Gothic Neo','Noto Sans KR',sans-serif}
      #pinGateBox{width:100%;max-width:320px;padding:32px 28px;text-align:center}
      #pinGateBox .pg-emoji{font-size:40px;margin-bottom:14px}
      #pinGateBox h2{color:#e8eaf6;font-size:18px;font-weight:800;margin-bottom:6px}
      #pinGateBox p{color:#7b80a0;font-size:13px;margin-bottom:22px}
      #pinGateInput{width:100%;background:rgba(255,255,255,.06);border:1px solid #252940;border-radius:12px;color:#e8eaf6;font-size:28px;letter-spacing:14px;text-align:center;padding:14px 0;font-family:inherit;outline:none;box-sizing:border-box}
      #pinGateInput:focus{border-color:#5c6bc0}
      #pinGateInput.pg-shake{animation:pg-shake .4s}
      @keyframes pg-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}
      #pinGateMsg{color:#ef5350;font-size:12px;margin-top:10px;min-height:16px}
      .pg-change-btn{position:fixed;right:16px;bottom:20px;z-index:9000;background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:20px;padding:8px 14px;font-size:12px;cursor:pointer;font-family:inherit}
    `;
    document.head.appendChild(style);
  }

  function showOverlay(correctHash) {
    injectStyle();
    const overlay = document.createElement('div');
    overlay.id = 'pinGateOverlay';
    overlay.innerHTML = `
      <div id="pinGateBox">
        <div class="pg-emoji">🔒</div>
        <h2>비밀번호를 입력하세요</h2>
        <p>이 여행 페이지는 4자리 PIN으로 잠겨 있습니다</p>
        <input id="pinGateInput" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off">
        <div id="pinGateMsg"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#pinGateInput');
    const msg = overlay.querySelector('#pinGateMsg');
    setTimeout(() => input.focus(), 50);

    input.addEventListener('input', async () => {
      input.value = input.value.replace(/[^0-9]/g, '').slice(0, 4);
      if (input.value.length === 4) {
        const hash = await sha256Hex(input.value);
        if (hash === correctHash) {
          localStorage.setItem(UNLOCK_KEY, '1');
          overlay.remove();
          addChangeBtn();
        } else {
          msg.textContent = '비밀번호가 올바르지 않습니다';
          input.classList.add('pg-shake');
          input.value = '';
          setTimeout(() => input.classList.remove('pg-shake'), 400);
        }
      }
    });
  }

  function addChangeBtn() {
    if (document.getElementById('pgChangeBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'pgChangeBtn';
    btn.className = 'pg-change-btn';
    btn.textContent = '🔒 PIN 변경';
    btn.onclick = changePin;
    document.body.appendChild(btn);
  }

  async function changePin() {
    const cur = prompt('현재 4자리 PIN을 입력하세요');
    if (cur === null) return;
    const curHash = await sha256Hex(cur);
    const storedHash = await fetchHash();
    if (curHash !== storedHash) { alert('현재 PIN이 올바르지 않습니다'); return; }
    const next1 = prompt('새 4자리 PIN을 입력하세요');
    if (next1 === null || !/^[0-9]{4}$/.test(next1)) { alert('4자리 숫자로 입력해 주세요'); return; }
    const next2 = prompt('새 PIN을 한 번 더 입력하세요');
    if (next1 !== next2) { alert('입력한 PIN이 서로 다릅니다'); return; }
    await saveHash(await sha256Hex(next1));
    alert('PIN이 변경되었습니다');
  }

  (async function init() {
    if (localStorage.getItem(UNLOCK_KEY) === '1') {
      addChangeBtn();
      return;
    }
    let hash = await fetchHash();
    if (!hash) hash = await bootstrapHash();
    showOverlay(hash);
  })();
})();
