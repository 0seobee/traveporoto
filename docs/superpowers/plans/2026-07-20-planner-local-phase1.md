# Phase 1 로컬 플래너 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `여행플래너_멀티유저_PRD.md`의 Phase 1(로컬 전용)을 구현한다 — 로그인 없이 브라우저 IndexedDB에 저장되는 "지인용" 여행 플래너를 새 파일로 만들고, 기존 `planner.html`(가족이 현재 실사용 중, Supabase 백엔드)은 전혀 건드리지 않는다.

**Architecture:** `planner.html`은 모든 데이터 접근을 `sbGet/sbPost/sbPatch/sbDelete` 4개 헬퍼 함수로만 통과시킨다(코드 확인 완료). 이 4개 함수와 동일한 시그니처를 갖는 IndexedDB 기반 로컬 구현체(`local-store.js`)를 만들고, `planner.html`을 복사한 `planner-local.html`에서 Supabase 설정/헬퍼 대신 이 스크립트를 사용하도록 교체한다. 사진 갤러리는 Cloudinary 업로드 대신 Blob을 IndexedDB에 직접 저장한다.

**Tech Stack:** 순수 Vanilla JS, IndexedDB (라이브러리 없음). 기존 프로젝트에 빌드 도구나 테스트 프레임워크가 없으므로 이 계획도 동일한 패턴을 따르고, 자동화 테스트 대신 브라우저 수동 검증 단계를 사용한다.

## Global Constraints

- 기존 `planner.html`, `proto.html`, `hub.html`, `pin-gate.js`는 이 작업에서 수정하지 않는다 (가족이 쓰는 실사용 데이터 보호).
- 새 기능은 전부 무료로 동작해야 한다 (외부 유료 서비스 신규 도입 금지).
- `sbGet(table, query)` / `sbPost(table, data)` / `sbPatch(table, id, data)` / `sbDelete(table, id)` 4개 함수의 이름과 시그니처는 `planner.html`과 동일하게 유지한다 (복사한 파일의 호출부를 고치지 않기 위함).
- `local-store.js`가 지원해야 하는 실제 쿼리 패턴(코드 전수 확인 결과, 이 5가지 외에는 없음):
  1. 쿼리 없음 → 전체 행
  2. `order=col.asc,col2.asc`
  3. `col=eq.value` (+ 선택적 `&order=...`)
  4. `tab_id=in.(id1,id2,...)`
  5. `col=eq.value&data->>__meta=eq.true` (JSON 필드 비교)

---

### Task 1: `local-store.js` 작성 — IndexedDB 기반 로컬 저장소

**Files:**
- Create: `C:\Users\user\Desktop\포르투칼 여행\local-store.js`

**Interfaces:**
- Produces: `sbGet(table, query='')`, `sbPost(table, data)`, `sbPatch(table, id, data)`, `sbDelete(table, id)`, `sbPostMany(table, dataArray)`, `lsExportBackup()`, `lsImportBackup(file)` — 전역 함수로 노출 (모듈 시스템 없음, `planner-local.html`이 `<script>` 태그로 그대로 로드해서 씀)

- [ ] **Step 1: 파일 작성**

```javascript
// local-store.js — planner-local.html 전용 IndexedDB 기반 로컬 저장소
// Supabase REST 헬퍼(sbGet/sbPost/sbPatch/sbDelete)와 동일한 시그니처로 동작한다.
(function () {
  const LS_DB_NAME = 'travel_planner_local';
  const LS_DB_VERSION = 1;
  const LS_STORES = ['projects', 'tabs', 'tab_items', 'gifts', 'ledger', 'checklist', 'photos'];

  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(LS_DB_NAME, LS_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        LS_STORES.forEach(name => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function getAll(table) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const req = db.transaction(table, 'readonly').objectStore(table).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  function readPath(row, path) {
    if (path.includes('->>')) {
      const [base, key] = path.split('->>');
      return row[base] ? row[base][key] : undefined;
    }
    return row[path];
  }

  function parseQuery(query) {
    const filters = [];
    let orderBy = null;
    if (!query) return { filters, orderBy };
    query.split('&').forEach(part => {
      if (!part) return;
      const eqIdx = part.indexOf('=');
      const key = part.slice(0, eqIdx);
      const val = part.slice(eqIdx + 1);
      if (key === 'order') {
        orderBy = val.split(',').map(seg => {
          const [col, dir] = seg.split('.');
          return { col, dir: dir || 'asc' };
        });
        return;
      }
      if (val.startsWith('eq.')) {
        filters.push({ key, op: 'eq', value: decodeURIComponent(val.slice(3)) });
      } else if (val.startsWith('in.(') && val.endsWith(')')) {
        filters.push({ key, op: 'in', value: val.slice(4, -1).split(',').filter(Boolean) });
      }
    });
    return { filters, orderBy };
  }

  async function sbGet(table, query = '') {
    const rows = await getAll(table);
    const { filters, orderBy } = parseQuery(query);
    let result = rows.filter(row => filters.every(f => {
      const rowVal = readPath(row, f.key);
      if (f.op === 'eq') return String(rowVal) === f.value;
      if (f.op === 'in') return f.value.includes(String(rowVal));
      return true;
    }));
    if (orderBy) {
      result = result.slice().sort((a, b) => {
        for (const { col, dir } of orderBy) {
          const av = a[col], bv = b[col];
          if (av === bv) continue;
          if (av === undefined || av === null) return -1;
          if (bv === undefined || bv === null) return 1;
          const cmp = av < bv ? -1 : 1;
          return dir === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
    }
    return result;
  }

  async function sbPost(table, data) {
    const db = await openDB();
    const row = Object.assign({}, data, {
      id: data.id || uuid(),
      created_at: data.created_at || new Date().toISOString()
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite');
      tx.objectStore(table).put(row);
      tx.oncomplete = () => resolve(row);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function sbPostMany(table, dataArray) {
    const db = await openDB();
    const rows = dataArray.map(data => Object.assign({}, data, {
      id: data.id || uuid(),
      created_at: data.created_at || new Date().toISOString()
    }));
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite');
      const store = tx.objectStore(table);
      rows.forEach(row => store.put(row));
      tx.oncomplete = () => resolve(rows);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function sbPatch(table, id, data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite');
      const store = tx.objectStore(table);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result || { id };
        store.put(Object.assign({}, existing, data, { id }));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function sbDelete(table, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite');
      tx.objectStore(table).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── 백업 내보내기/가져오기 (기기 변경·브라우저 데이터 삭제 대비 안전망) ──
  async function lsExportBackup() {
    const dump = {};
    for (const table of LS_STORES) {
      const rows = await getAll(table);
      // Blob(사진 원본)은 JSON으로 직렬화할 수 없으니 base64 데이터 URL로 변환
      dump[table] = await Promise.all(rows.map(async row => {
        if (row.blob instanceof Blob) {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(row.blob);
          });
          const { blob, ...rest } = row;
          return Object.assign({}, rest, { blob_data_url: dataUrl });
        }
        return row;
      }));
    }
    const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tables: dump }, null, 2);
    const file = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = `travel-planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function dataUrlToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(',');
    const mime = meta.match(/data:(.*);base64/)[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function lsImportBackup(file) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const db = await openDB();
    const tables = parsed.tables || {};
    for (const table of LS_STORES) {
      const rows = tables[table] || [];
      await new Promise((resolve, reject) => {
        const tx = db.transaction(table, 'readwrite');
        const store = tx.objectStore(table);
        rows.forEach(row => {
          if (row.blob_data_url) {
            const { blob_data_url, ...rest } = row;
            store.put(Object.assign({}, rest, { blob: dataUrlToBlob(blob_data_url) }));
          } else {
            store.put(row);
          }
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  window.sbGet = sbGet;
  window.sbPost = sbPost;
  window.sbPatch = sbPatch;
  window.sbDelete = sbDelete;
  window.sbPostMany = sbPostMany;
  window.lsExportBackup = lsExportBackup;
  window.lsImportBackup = lsImportBackup;
})();
```

- [ ] **Step 2: 브라우저 콘솔에서 수동 검증**

`local-store.js`만 로드하는 빈 HTML에서 콘솔로:
```js
await sbPost('projects', { name: '테스트' });
await sbGet('projects'); // [{id:..., name:'테스트', created_at:...}] 확인
```
Expected: 두 호출 모두 에러 없이 예상된 배열/객체 반환.

- [ ] **Step 3: 커밋**

```bash
git add local-store.js
git commit -m "feat: add IndexedDB-backed local storage layer for planner-local"
```

---

### Task 2: `planner-local.html` 생성 — Supabase/Cloudinary를 로컬 저장소로 교체

**Files:**
- Create: `C:\Users\user\Desktop\포르투칼 여행\planner-local.html` (`planner.html` 복사본)
- Modify: 위 파일 내부만 (원본 `planner.html`은 손대지 않음)

**Interfaces:**
- Consumes: Task 1의 `local-store.js`가 제공하는 `sbGet/sbPost/sbPatch/sbDelete/sbPostMany/lsExportBackup/lsImportBackup`

- [ ] **Step 1: 파일 복사**

```bash
cp "planner.html" "planner-local.html"
```

- [ ] **Step 2: PIN 게이트 제거 (로그인 개념 자체가 없는 Phase 1)**

`planner-local.html`에서:
```html
<script src="pin-gate.js" data-page-key="auto"></script>
```
줄을 삭제한다.

- [ ] **Step 3: Supabase 설정/헬퍼 블록을 local-store.js 로드로 교체**

`planner-local.html`에서 다음 블록(`// ── Supabase ──` 주석부터 `sbDelete` 함수 닫는 `}`까지)을 통째로 삭제하고:
```javascript
// ── Supabase ──
const SB_URL = 'https://ciljiutblgbnwlgcdiyq.supabase.co';
const SB_KEY = '...';
const SB_H  = { ... };
const SB_HR = { ...SB_H, 'Prefer': 'return=representation' };

async function sbGet(table, query='') { ... }
async function sbPost(table, data) { ... }
async function sbPatch(table, id, data) { ... }
async function sbDelete(table, id) { ... }
```
그 자리에 주석만 남긴다:
```javascript
// ── 저장소: local-store.js가 sbGet/sbPost/sbPatch/sbDelete/sbPostMany를 전역으로 제공 ──
```
그리고 `<head>` 또는 body 상단(기존 `pin-gate.js` 있던 자리)에 다음을 추가한다:
```html
<script src="local-store.js"></script>
```

- [ ] **Step 4: 대량 삽입 raw fetch 2곳을 `sbPostMany`로 교체**

`batchInsertSchedItems` 함수 내부:
```javascript
// 변경 전
for (let i = 0; i < rows.length; i += 50) {
  await fetch(`${SB_URL}/rest/v1/tab_items`, { method:'POST', headers:SB_H, body:JSON.stringify(rows.slice(i,i+50)) });
}
// 변경 후
await sbPostMany('tab_items', rows);
```

KML 가져오기 함수 내부(동일 패턴):
```javascript
// 변경 전
const batchSize = 50;
for (let i = 0; i < rows.length; i += batchSize) {
  await fetch(`${SB_URL}/rest/v1/tab_items`, { method: 'POST', headers: SB_H, body: JSON.stringify(rows.slice(i, i + batchSize)) });
}
// 변경 후
await sbPostMany('tab_items', rows);
```

- [ ] **Step 5: `applyBgUrl`의 raw fetch를 `sbPatch`로 교체**

```javascript
// 변경 전
async function applyBgUrl(url) {
  const el = document.getElementById('heroBgEl');
  if (el) el.style.backgroundImage = `url('${url}')`;
  currentProject.cover_bg = url;
  closeBgPicker();
  try {
    const r = await fetch(`${SB_URL}/rest/v1/projects?id=eq.${currentProject.id}`, {
      method: 'PATCH',
      headers: { ...SB_H, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ cover_bg: url })
    });
    if (!r.ok) console.error('배경 저장 실패', r.status, await r.text());
  } catch(e) { console.error('배경 저장 오류', e); }
}

// 변경 후
async function applyBgUrl(url) {
  const el = document.getElementById('heroBgEl');
  if (el) el.style.backgroundImage = `url('${url}')`;
  currentProject.cover_bg = url;
  closeBgPicker();
  await sbPatch('projects', currentProject.id, { cover_bg: url });
}
```

- [ ] **Step 6: 갤러리 업로드를 Cloudinary 대신 로컬 Blob 저장으로 교체**

`renderGallery` 함수 시작부(`galPhotos = await sbGet(...)` 다음 줄)에 blob→object URL 매핑을 추가:
```javascript
async function renderGallery(container, tab) {
  galPhotos = await sbGet('photos', `project_id=eq.${currentProject.id}&order=created_at.desc`);
  galPhotos = galPhotos.map(p => {
    const url = p.url || (p.blob ? URL.createObjectURL(p.blob) : '');
    return Object.assign({}, p, { url, thumb_url: p.thumb_url || url });
  });
  const nick = localStorage.getItem(NICK_KEY);
  // ... 이하 기존 코드 그대로
```

`uploadGalPhotos` 함수를 Cloudinary 호출 없이 로컬 저장으로 교체:
```javascript
async function uploadGalPhotos(input) {
  const files = [...input.files];
  if (!files.length) return;
  const nick = getNickname();
  if (!nick) return;
  const btn = document.getElementById('galUpBtn');
  const prog = document.getElementById('galProgress');
  btn.disabled = true;
  let done = 0, failed = 0;
  for (const file of files) {
    prog.textContent = `저장 중… ${done + 1}/${files.length}`;
    try {
      await sbPost('photos', { project_id: currentProject.id, blob: file, nickname: nick });
      done++;
    } catch (err) {
      console.error('저장 실패:', err);
      failed++;
    }
  }
  btn.disabled = false;
  prog.textContent = failed ? `⚠️ ${done}장 성공, ${failed}장 실패` : '';
  input.value = '';
  await renderGallery(document.getElementById('tabContent'), currentTab);
}
```

- [ ] **Step 7: 대시보드 화면에 백업 내보내기/가져오기 버튼 추가**

`nav` 요소(`</nav>` 직전)에 버튼 추가:
```html
<input type="file" id="backupImportInput" accept="application/json" style="display:none" onchange="handleImportBackup(this)">
<button class="nav-btn" style="background:transparent;border:1px solid var(--border)" onclick="lsExportBackup()" title="내 여행 데이터를 파일로 저장">⬇ 백업</button>
<button class="nav-btn" style="background:transparent;border:1px solid var(--border)" onclick="document.getElementById('backupImportInput').click()" title="백업 파일에서 복원">⬆ 복원</button>
```
그리고 `toggleTheme` 정의 근처 `<script>` 블록에 핸들러 추가:
```javascript
async function handleImportBackup(input) {
  const file = input.files[0];
  if (!file) return;
  if (!confirm('백업 파일을 가져오면 같은 id를 가진 기존 데이터가 덮어써집니다. 계속할까요?')) { input.value = ''; return; }
  await lsImportBackup(file);
  input.value = '';
  alert('가져오기가 완료됐습니다. 페이지를 새로고침합니다.');
  location.reload();
}
```

- [ ] **Step 8: 페이지 제목/문구를 "지인용 로컬 플래너"로 구분**

`<title>` 태그와 nav 로고 텍스트(`🗺️ 여행 플래너`)에 손대지 않아도 되지만, 두 파일을 혼동하지 않도록 `<title>`만 다음처럼 바꾼다:
```html
<title>여행 플래너 (내 브라우저 저장)</title>
```

- [ ] **Step 9: 커밋**

```bash
git add planner-local.html
git commit -m "feat: add local-storage-only planner variant for friends to use for free"
```

---

### Task 3: `hub.html`에 새 플래너로 가는 카드 추가

**Files:**
- Modify: `C:\Users\user\Desktop\포르투칼 여행\hub.html`

- [ ] **Step 1: 고정 카드 추가**

`<div class="new-card" onclick="openModal()">` 카드 바로 앞에 새 카드를 추가한다:
```html
<a class="project-card" href="planner-local.html" style="background:linear-gradient(135deg,#37474f,#546e7a)">
  <div class="project-card-cover" style="background:transparent;height:100px">🧳</div>
  <div class="project-card-body">
    <div class="project-card-name" style="color:#fff">내 여행 만들기 (로그인 불필요)</div>
    <div class="project-card-dest" style="color:rgba(255,255,255,.7)">브라우저에만 저장 · 지인과 공유 가능</div>
  </div>
</a>
```

- [ ] **Step 2: 브라우저에서 육안 확인**

`hub.html`을 열어 새 카드가 보이는지, 클릭 시 `planner-local.html`로 이동하는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add hub.html
git commit -m "feat: link local-only planner from hub"
```

---

### Task 4: 엔드투엔드 수동 검증 (브라우저)

**Files:** 없음 (검증만)

- [ ] **Step 1:** 로컬 서버 기동 (`python -m http.server 4500`), `http://localhost:4500/planner-local.html` 접속 — PIN 팝업 없이 바로 대시보드가 뜨는지 확인
- [ ] **Step 2:** "새 여행 추가" → 이름/목적지 입력 후 저장 → 카드가 대시보드에 표시되는지 확인
- [ ] **Step 3:** 프로젝트 열어 "일정형" 탭 추가 → 일정 1개 입력 → 저장되는지 확인
- [ ] **Step 4:** 페이지 새로고침(F5) 후에도 방금 만든 여행과 일정이 그대로 남아있는지 확인 (IndexedDB 영속성 검증)
- [ ] **Step 5:** "갤러리형" 탭 추가 → 사진 1장 업로드 → 썸네일이 뜨는지, 새로고침 후에도 사진이 남아있는지 확인 (Blob 영속성 검증)
- [ ] **Step 6:** "⬇ 백업" 클릭 → JSON 파일이 다운로드되는지 확인 → 파일을 열어 방금 만든 프로젝트/일정/사진(base64)이 들어있는지 확인
- [ ] **Step 7:** 브라우저 개발자도구 Application 탭에서 IndexedDB `travel_planner_local` 데이터를 수동 삭제 → 페이지 새로고침 → 대시보드가 비어있는지 확인 → "⬆ 복원"으로 방금 받은 백업 파일을 가져와 데이터가 복구되는지 확인
- [ ] **Step 8:** `http://localhost:4500/planner.html`(기존 가족용)을 별도로 열어 PIN 게이트가 여전히 뜨고 기존 데이터(포르투갈 등)가 그대로인지 확인 — 이번 작업이 기존 페이지에 영향을 주지 않았음을 최종 확인
