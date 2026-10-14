/* Smart Business Manager Pro — Service Worker
 * ዓላማ፦ ኢንተርኔት በሌለበት ጊዜም መተግበሪያው እንዲከፈት (ቢያንስ አንድ ጊዜ በኢንተርኔት ከተከፈተ በኋላ)።
 *
 * ህጎች፦
 *  - የመተግበሪያው ገጽ፦ መጀመሪያ ኢንተርኔት ይሞክራል (እስከ 3 ሰከንድ)፤ ካልተሳካ በስልኩ ውስጥ የተቀመጠውን ይከፍታል።
 *    ስለዚህ አዲስ ስሪት ሲጫን ኢንተርኔት ባለበት ጊዜ ወዲያው ይታያል።
 *  - የ Firebase SDK (gstatic.com፣ ስሪቱ የተወሰነ ነው)፦ አንድ ጊዜ ከተጫነ ከስልኩ ይነበባል።
 *  - ሌላ ማንኛውም ጥያቄ (Firestore፣ Auth ወዘተ) አይነካም፤ በቀጥታ ወደ ኢንተርኔት ይሄዳል።
 */
const CACHE = "sbm-shell-v1";
const CACHE_PREFIX = "sbm-shell-";
const SCOPE = self.registration.scope; // ለምሳሌ https://aburumeysaadi1111-crypto.github.io/smartbiz-new/
const INDEX_URL = new URL("./", SCOPE).href;
const NET_TIMEOUT_MS = 3000;
const SDK_URLS = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js",
];
const OFFLINE_HTML =
  '<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
  "<title>ኢንተርኔት የለም</title></head>" +
  '<body style="font-family:sans-serif;padding:30px;text-align:center;line-height:1.7">' +
  "<h2>📡 ኢንተርኔት የለም</h2>" +
  "<p>ይህ መተግበሪያ በዚህ ስልክ ላይ ለመጀመሪያ ጊዜ ሲከፈት ኢንተርኔት ያስፈልገዋል።</p>" +
  "<p>እባክዎ ኢንተርኔት ያብሩና ገጹን ያድሱ።</p></body></html>";

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req).then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 1) የመተግበሪያው ገጽ — መሳካት አለበት፤ ካልተሳካ ቀጣዩ ጉብኝት እንደገና ይሞክራል
      const res = await fetch(new Request(INDEX_URL, { cache: "reload" }));
      if (!res || !res.ok) throw new Error("index fetch failed");
      await cache.put(INDEX_URL, res);
      // 2) Firebase SDK — ቢወድቅም ችግር የለም (በኋላ በመጀመሪያው አጠቃቀም ይቀመጣል)
      await Promise.all(
        SDK_URLS.map(async (u) => {
          try {
            const r = await fetch(new Request(u, { mode: "no-cors" }));
            await cache.put(u, r);
          } catch (e) { /* ችላ */ }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

async function handleNavigate(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetchWithTimeout(req, NET_TIMEOUT_MS);
    if (res && res.ok) {
      cache.put(INDEX_URL, res.clone()).catch(() => {});
      return res;
    }
    const hit = await cache.match(INDEX_URL);
    return hit || res;
  } catch (e) {
    const hit = await cache.match(INDEX_URL);
    if (hit) return hit;
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetchWithTimeout(req, NET_TIMEOUT_MS);
    if (res && res.ok) cache.put(req.url, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await cache.match(req.url);
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  try {
    if (res && (res.ok || res.type === "opaque")) await cache.put(req.url, res.clone());
  } catch (e) { /* ችላ */ }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (SDK_URLS.indexOf(req.url) !== -1) {
    event.respondWith(cacheFirst(req));
    return;
  }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firestore, Auth ወዘተ አይነኩም
  if (url.href.indexOf(SCOPE) !== 0) return; // ከዚህ ፎልደር ውጭ ያሉ አይነኩም
  if (req.mode === "navigate") {
    event.respondWith(handleNavigate(req));
    return;
  }
  event.respondWith(networkFirst(req));
});
