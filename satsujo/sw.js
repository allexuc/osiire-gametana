// 札上の楼閣 のオフライン用キャッシュ(tools/shelf.py build が作成。直接編集しない)
// ゲームのページ: ネット優先(つながっていれば常に最新)。ほかのファイルとフォント: キャッシュを先に返して裏で更新
const PREFIX='satsujo-';
const CACHE=PREFIX+'v1.0.2';
const HOME=new URL('./',self.location).pathname;
const CORE=["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
// 同じドメインに並ぶほかのゲームのキャッシュは消さない(自分の PREFIX の古い版だけ片付ける)
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(r.mode==='navigate'){
    const page=u.pathname===HOME||u.pathname===HOME+'index.html';
    e.respondWith(fetch(r).then(res=>{if(page&&res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put('./index.html',cp));}return res;}).catch(()=>caches.match('./index.html')));
    return;
  }
  const fontHost=u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com';
  if(u.origin!==location.origin&&!fontHost)return;
  e.respondWith(caches.match(r).then(hit=>{
    const net=fetch(r).then(res=>{if(res&&(res.ok||res.type==='opaque')){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp));}return res;}).catch(()=>hit);
    return hit||net;
  }));
});
