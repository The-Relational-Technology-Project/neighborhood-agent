/**
 * The service worker. It keeps a copy of the home page and its few static files on the device and
 * answers from that copy first, then refreshes the copy in the background. A home-screen launch
 * paints at once even when the server is waking up. Chat, live readings and every other page
 * always go to the network; nothing a neighbor types is ever stored here.
 */
export const swScript = String.raw`
var CACHE = 'shell-v1';
var STATIC = /^\/(brand\/[\w.-]+|chat\.js|favicon\.png|apple-touch-icon\.png|manifest\.webmanifest)$/;
var FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(['/', '/chat.js']); }).catch(function(){}));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
// Answer from the copy when there is one; either way fetch a fresh one and keep it for next time.
function staleWhileRevalidate(e, key){
  var fresh;
  e.respondWith(caches.open(CACHE).then(function(c){
    return c.match(key).then(function(hit){
      fresh = fetch(e.request).then(function(res){
        if (res && (res.ok || res.type === 'opaque')) return c.put(key, res.clone()).then(function(){ return res; });
        return res;
      });
      if (!hit) return fresh;
      fresh = fresh.catch(function(){});
      return hit;
    });
  }));
  e.waitUntil(Promise.resolve().then(function(){ return fresh; }).catch(function(){}));
}
self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' && url.pathname === '/') return staleWhileRevalidate(e, '/');
    if (STATIC.test(url.pathname)) return staleWhileRevalidate(e, url.pathname);
    return;
  }
  if (FONT_HOSTS.indexOf(url.hostname) !== -1) return staleWhileRevalidate(e, req.url);
});
`;
