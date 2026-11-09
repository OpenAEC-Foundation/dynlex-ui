// Browser capabilities, without application state, layout or interaction rules.
export function createWebServices(base) {
  const currentLocation = () => ({ url: location.href, path: location.pathname,
    hash: new URLSearchParams('value=' + location.hash.slice(1).replaceAll('+', '%2B')).get('value'),
    search: Object.fromEntries(new URLSearchParams(location.search)) });
  return {
    async environment() {
      const hints = navigator.userAgentData === undefined ? null
        : await navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'platform']);
      return { userAgent: navigator.userAgent, language: navigator.language,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        touchPoints: navigator.maxTouchPoints, hints, location: currentLocation() };
    },
    location(payload, { signal, emit }) {
      if (payload.action === 'read') return currentLocation();
      if (payload.action === 'watch') return new Promise(resolve => {
        const changed = () => emit({ type: 'location', ...currentLocation() });
        addEventListener('popstate', changed); addEventListener('hashchange', changed); changed();
        signal.addEventListener('abort', () => {
          removeEventListener('popstate', changed); removeEventListener('hashchange', changed); resolve(null);
        }, { once: true });
      });
      if (payload.action === 'push') history.pushState(null, '', payload.url);
      else if (payload.action === 'replace') history.replaceState(null, '', payload.url);
      else throw new Error(`Unknown history operation: ${payload.action}`);
      return currentLocation();
    },
    storage(payload) {
      const storage = payload.area === 'session' ? sessionStorage : localStorage;
      if (payload.action === 'get') return { value: storage.getItem(payload.key) };
      if (payload.action === 'keys') return Array.from({ length: storage.length }, (_, index) => storage.key(index));
      if (payload.action === 'set') storage.setItem(payload.key, payload.value);
      else if (payload.action === 'delete') storage.removeItem(payload.key);
      else throw new Error(`Unknown storage operation: ${payload.action}`);
      return null;
    },
    document(payload) {
      if (payload.action !== 'metadata') throw new Error(`Unknown document operation: ${payload.action}`);
      document.title = payload.title;
      document.querySelector('meta[name="description"]').content = payload.description;
      let canonical = document.querySelector('link[rel="canonical"]');
      if (canonical === null) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
      canonical.href = new URL(payload.path, location.origin);
      return null;
    },
    log(payload) { console[payload.level](payload.message); return null; },
    async fetch(payload, { signal }) {
      const response = await fetch(new URL(payload.url, base), { method: payload.method ?? 'GET',
        headers: payload.headers, body: payload.body, signal });
      return { status: response.status, text: await response.text() };
    },
    open(payload) {
      if (payload.newTab) window.open(payload.url, '_blank', 'noopener,noreferrer');
      else location.assign(payload.url);
      return null;
    },
    download(payload) {
      const url = URL.createObjectURL(new Blob([payload.content], { type: payload.type }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = payload.name;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
      return null;
    }
  };
}
