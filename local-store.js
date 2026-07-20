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
          const rest = Object.assign({}, row);
          delete rest.blob;
          return Object.assign(rest, { blob_data_url: dataUrl });
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
            const rest = Object.assign({}, row);
            delete rest.blob_data_url;
            store.put(Object.assign(rest, { blob: dataUrlToBlob(row.blob_data_url) }));
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
