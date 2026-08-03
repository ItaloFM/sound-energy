const CACHE = "sound-energy-v1";
const FILES = [
    "/sound-energy/index.html",
    "/sound-energy/style.css",
    "/sound-energy/script.js",
    "/sound-energy/imgs/2243c3de-9ed4-4bf6-8874-9e36f36f4d09.png"
];

self.addEventListener("install", e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});

self.addEventListener("activate", e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE)
                    .map(key => caches.delete(key))
            )
        )
    );
});

self.addEventListener("fetch", e => {
    e.respondWith(
        caches.match(e.request).then(r => r || fetch(e.request))
    );
});
