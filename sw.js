/* Service Worker — ศูนย์ดำรงธรรมหนองบัวลำภู
 * กลยุทธ์: network-first สำหรับหน้าเว็บ (กันแคชค้าง / เห็นข้อมูลใหม่เสมอ)
 *          ถ้าออฟไลน์ค่อย fallback ไปแคช
 * บัมพ์เลข CACHE_VERSION ทุกครั้งที่อัปเดตไฟล์ เพื่อล้างแคชเก่า
 */
const CACHE_VERSION = 'nbl-damrongdham-v5';
const CORE = [
  './',
  './index.html',
  './entry.html',
  './manifest.json',
  './assets/seal.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './assets/nbl-tambon.topo.json'
];

self.addEventListener('install', e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_VERSION).then(c=>c.addAll(CORE).catch(()=>{})));
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_VERSION).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // ไม่แคชการเรียก Google Apps Script / Sheets (ต้องสดเสมอ)
  if(url.hostname.indexOf('script.google')>=0 || url.hostname.indexOf('googleusercontent')>=0) return;

  // network-first
  e.respondWith(
    fetch(req).then(res=>{
      if(res && res.status===200 && (url.origin===location.origin)){
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c=>c.put(req, copy));
      }
      return res;
    }).catch(()=> caches.match(req).then(r=> r || caches.match('./index.html')))
  );
});
