/** Unified browser extension API for Chromium and Firefox. */

type BrowserNamespace = typeof chrome;

function getApi(): BrowserNamespace {
  const g = globalThis as typeof globalThis & {
    browser?: BrowserNamespace;
    chrome?: BrowserNamespace;
  };
  if (g.browser?.runtime?.id) return g.browser;
  if (g.chrome?.runtime?.id) return g.chrome;
  throw new Error("Extension API unavailable");
}

export const browserApi = {
  get runtime() {
    return getApi().runtime;
  },
  get tabs() {
    return getApi().tabs;
  },
  get storage() {
    return getApi().storage;
  },
  get downloads() {
    return getApi().downloads;
  },
  get i18n() {
    return getApi().i18n;
  },
  get action() {
    return getApi().action;
  },

  async sendMessage<T = unknown>(message: unknown): Promise<T> {
    return getApi().runtime.sendMessage(message) as Promise<T>;
  },

  async sendTabMessage<T = unknown>(
    tabId: number,
    message: unknown,
  ): Promise<T> {
    return getApi().tabs.sendMessage(tabId, message) as Promise<T>;
  },

  async storageGet<T extends Record<string, unknown>>(
    defaults: T,
  ): Promise<T> {
    const result = await getApi().storage.sync.get(defaults);
    return { ...defaults, ...result } as T;
  },

  async storageSet(values: Record<string, unknown>): Promise<void> {
    await getApi().storage.sync.set(values);
  },

  async storageLocalGet<T extends Record<string, unknown>>(
    defaults: T,
  ): Promise<T> {
    const api = getApi().storage.local ?? getApi().storage.sync;
    const result = await api.get(defaults);
    return { ...defaults, ...result } as T;
  },

  async storageLocalSet(values: Record<string, unknown>): Promise<void> {
    const api = getApi().storage.local ?? getApi().storage.sync;
    await api.set(values);
  },

  async download(options: chrome.downloads.DownloadOptions): Promise<number> {
    // Never allow a Save As dialog from NovaDownloader — always force false.
    const forced: chrome.downloads.DownloadOptions = {
      url: options.url,
      filename: options.filename,
      conflictAction: options.conflictAction || "uniquify",
      saveAs: false,
    };
    const api = getApi().downloads;
    const result = api.download(forced) as Promise<number> | undefined;
    if (result && typeof result.then === "function") {
      return result;
    }
    return new Promise<number>((resolve, reject) => {
      api.download(forced, (id) => {
        const err = getApi().runtime?.lastError;
        if (err?.message) {
          reject(new Error(err.message));
          return;
        }
        if (typeof id !== "number") {
          reject(new Error("Chrome n’a pas démarré le téléchargement."));
          return;
        }
        resolve(id);
      });
    });
  },

  async downloadsSearch(
    query: chrome.downloads.DownloadQuery,
  ): Promise<chrome.downloads.DownloadItem[]> {
    return getApi().downloads.search(query);
  },

  async downloadsPause(downloadId: number): Promise<void> {
    await getApi().downloads.pause(downloadId);
  },

  async downloadsResume(downloadId: number): Promise<void> {
    await getApi().downloads.resume(downloadId);
  },

  async downloadsCancel(downloadId: number): Promise<void> {
    await getApi().downloads.cancel(downloadId);
  },

  async downloadsOpen(downloadId: number): Promise<void> {
    await getApi().downloads.open(downloadId);
  },

  async downloadsShow(downloadId: number): Promise<void> {
    await getApi().downloads.show(downloadId);
  },

  async queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    const tabs = await getApi().tabs.query({
      active: true,
      currentWindow: true,
    });
    return tabs[0];
  },
};
