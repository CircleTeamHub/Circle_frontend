/**
 * 一个刚好够用的 IndexedDB 替身，给 loadTsModule 加载的 `.web.ts` 平台档用。
 *
 * 只实现被测代码真正会碰的那几件事：open（含 onupgradeneeded）、一个对象仓库的
 * get / put / delete / getAllKeys，以及事务的 abort。回调一律排到微任务里触发 ——
 * 真实的 IDBRequest 也是这样，调用方在同步返回后才挂上 onsuccess/onerror。
 *
 * 同时给出 URL 的替身：createObjectURL 走真实现（Node 支持 blob: 的 fetch），
 * revokeObjectURL 记一笔再转发，好断言 object URL 确实被回收了。
 */

function createRequest(execute) {
  const request = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  queueMicrotask(() => {
    try {
      request.result = execute();
      request.onsuccess?.();
    } catch (err) {
      request.error = err;
      request.onerror?.();
    }
  });
  return request;
}

function createFakeIndexedDb() {
  /** name → Blob。相当于原生端 Documents 下的那个目录。 */
  const entries = new Map();
  const revoked = [];
  const storeNames = new Set();
  let openFails = false;

  const database = {
    objectStoreNames: { contains: (name) => storeNames.has(name) },
    createObjectStore: (name) => {
      storeNames.add(name);
    },
    transaction: () => {
      const transaction = { error: null, onabort: null };
      transaction.objectStore = () => ({
        get: (key) => createRequest(() => entries.get(key)),
        put: (value, key) =>
          createRequest(() => {
            entries.set(key, value);
            return key;
          }),
        delete: (key) =>
          createRequest(() => {
            entries.delete(key);
          }),
        getAllKeys: () => createRequest(() => [...entries.keys()]),
      });
      return transaction;
    },
  };

  const indexedDB = {
    open: () => {
      const request = {
        result: database,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        if (openFails) {
          request.error = new Error('fake indexedDB: open denied');
          request.onerror?.();
          return;
        }
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  const urlShim = {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => {
      revoked.push(url);
      URL.revokeObjectURL(url);
    },
  };

  return {
    entries,
    revoked,
    /** 之后的 open 一律失败：浏览器禁用站点数据、隐私模式等。 */
    failOpen: () => {
      openFails = true;
    },
    /** 交给 loadTsModule 的 `context`，即被测模块在 vm 里看到的浏览器全局。 */
    globals: { indexedDB, URL: urlShim, fetch, Blob },
    /** 同上，但完全没有 indexedDB —— SSG（expo export）在 Node 里就是这样。 */
    globalsWithoutIndexedDb: { URL: urlShim, fetch, Blob },
  };
}

module.exports = { createFakeIndexedDb };
