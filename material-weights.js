(function (root) {
  'use strict';

  const DATABASE_NAME = 'autocount-material-weights';
  const BACKUP_FORMAT = 'autocount-material-weights';
  const defaults = Object.freeze([
    ['V60100', 5.75], ['V60150', 8.63], ['V60300', 17.4],
    ['V61100', 6.8], ['V61150', 9.68], ['V62025', 2.28],
    ['V62050', 3.38], ['V62020', 2.2], ['U48601', 5.96], ['J48601', 4.91],
    ['H66060', 2.4], ['H66090', 3.18], ['H66150', 4.7], ['H66180', 5.5], ['H66240', 7.32],
    ['D60615', 5.62], ['D60915', 5.98], ['D61515', 6.8], ['D61815', 7.32], ['D62415', 8.66]
  ].map(([code, weight]) => Object.freeze({code, weight})));
  const codes = new Set(defaults.map(entry => entry.code));

  function validTimestamp(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
  }

  // 僅接受完整的 20 種桿件，依內建順序回傳獨立副本，不修改傳入資料。
  function validateEntries(entries) {
    if (!Array.isArray(entries) || entries.length !== defaults.length) {
      throw new Error('重量資料必須包含全部 20 種桿件。');
    }
    const catalog = new Map();
    for (const entry of Array.from(entries)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          !codes.has(entry.code) || catalog.has(entry.code)) {
        throw new Error('重量資料含缺漏、重複或不支援的桿件代碼。');
      }
      const weight = entry.weight;
      const cents = Math.round(weight * 100);
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 ||
          !Number.isSafeInteger(cents) || cents <= 0 || Number(weight.toFixed(2)) !== weight) {
        throw new Error(entry.code + ' 單重必須大於 0，最多保留小數點後 2 位，且不得超出可精確計算範圍。');
      }
      const clean = {code: entry.code, weight};
      if (entry.updatedAt !== undefined) {
        if (!validTimestamp(entry.updatedAt)) throw new Error('重量資料更新時間格式不正確。');
        clean.updatedAt = entry.updatedAt;
      }
      catalog.set(entry.code, clean);
    }
    return defaults.map(entry => catalog.get(entry.code));
  }

  // 重量以 0.01 kg 整數計算，避免逐項加總的浮點誤差。
  function calculateTotals(quantities, entries = defaults) {
    if (!Array.isArray(quantities) || quantities.length !== defaults.length ||
        Array.from(quantities).some(quantity => !Number.isSafeInteger(quantity) || quantity < 0)) {
      throw new Error('桿件數量必須是完整 20 項的非負整數。');
    }
    const catalog = validateEntries(entries);
    const subtotals = quantities.map((quantity, index) => quantity * Math.round(catalog[index].weight * 100));
    const total = subtotals.reduce((sum, subtotal) => sum + subtotal, 0);
    if (subtotals.some(subtotal => !Number.isSafeInteger(subtotal)) || !Number.isSafeInteger(total)) {
      throw new Error('數量或單重過大，無法精確計算總重。');
    }
    return {subtotals, total};
  }

  function formatWeight(cents) {
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('重量合計格式不正確。');
    return Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
  }

  function makeBackup(entries) {
    return {
      format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(),
      entries: validateEntries(entries)
    };
  }

  function parseBackup(value) {
    let backup = value;
    if (typeof value === 'string') {
      try { backup = JSON.parse(value); }
      catch (_) { throw new Error('無法讀取 JSON 重量備份，請檢查檔案內容。'); }
    }
    if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== 1 || !validTimestamp(backup.exportedAt)) {
      throw new Error('請選擇本工具匯出的有效重量資料備份。');
    }
    return validateEntries(backup.entries);
  }

  // 各頁共用同一資料庫；不存取前一版的清單資料庫。
  function createStore(factory, {databaseName = DATABASE_NAME} = {}) {
    let openPromise = null;
    let connection = null;

    function open() {
      if (openPromise) return openPromise;
      const pending = new Promise((resolve, reject) => {
        let request;
        let abandoned = false;
        try {
          const indexedDB = factory === undefined ? root.indexedDB : factory;
          if (!indexedDB || typeof indexedDB.open !== 'function') {
            throw new Error('此瀏覽器無法使用本機重量資料庫。');
          }
          request = indexedDB.open(databaseName, 1);
        } catch (failure) {
          reject(failure);
          return;
        }
        request.onupgradeneeded = () => {
          if (abandoned || openPromise !== pending) {
            request.transaction.abort();
            return;
          }
          const database = request.result;
          if (!database.objectStoreNames.contains('catalog')) {
            const catalog = database.createObjectStore('catalog', {keyPath: 'code'});
            const updatedAt = new Date().toISOString();
            defaults.forEach(entry => catalog.put({...entry, updatedAt}));
          }
        };
        request.onerror = () => {
          abandoned = true;
          reject(request.error || new Error('無法開啟本機重量資料庫。'));
        };
        request.onblocked = () => {
          abandoned = true;
          reject(new Error('重量資料庫遭其他分頁阻擋，請關閉本工具其他分頁後重試。'));
        };
        request.onsuccess = () => {
          const database = request.result;
          if (abandoned || openPromise !== pending) {
            database.close();
            reject(new Error('重量資料庫連線已關閉，請重試。'));
            return;
          }
          connection = database;
          const release = () => {
            database.close();
            if (connection === database) connection = null;
            if (openPromise === pending) openPromise = null;
          };
          database.onversionchange = release;
          database.onclose = release;
          resolve(database);
        };
      });
      openPromise = pending;
      pending.catch(() => { if (openPromise === pending) openPromise = null; });
      return pending;
    }

    async function transact(mode, operation) {
      const database = await open();
      return new Promise((resolve, reject) => {
        let transaction;
        let result;
        let failure;
        try { transaction = database.transaction('catalog', mode); }
        catch (error) { reject(error); return; }
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(failure || transaction.error || new Error('重量資料庫交易已取消。'));
        transaction.onerror = event => { failure = event.target.error || transaction.error || failure; };
        try {
          operation(transaction.objectStore('catalog'), value => { result = value; });
        } catch (error) {
          failure = error;
          try { transaction.abort(); }
          catch (_) { reject(error); }
        }
      });
    }

    async function load() {
      const entries = await transact('readonly', (catalog, setResult) => {
        const request = catalog.getAll();
        request.onsuccess = () => setResult(request.result);
      });
      return validateEntries(entries);
    }

    async function save(entries) {
      const updatedAt = new Date().toISOString();
      const clean = validateEntries(entries).map(entry => ({code: entry.code, weight: entry.weight, updatedAt}));
      await transact('readwrite', catalog => {
        // 完整目錄替換與 20 筆寫入共用交易，任何失敗均回滾。
        catalog.clear();
        clean.forEach(entry => catalog.put(entry));
      });
      return clean;
    }

    async function close() {
      const pending = openPromise;
      const database = connection;
      openPromise = null;
      connection = null;
      if (database) database.close();
      if (pending) {
        try { (await pending).close(); }
        catch (_) { /* 已失敗或被放棄的連線無須再關閉。 */ }
      }
    }

    return Object.freeze({load, save, reset: () => save(defaults), close});
  }

  const store = createStore();
  root.MaterialWeights = Object.freeze({
    defaults, validateEntries, calculateTotals, formatWeight, makeBackup, parseBackup,
    load: store.load, save: store.save, reset: store.reset, close: store.close, createStore
  });
})(typeof window === 'undefined' ? globalThis : window);
