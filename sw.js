// インストール処理（必須）
self.addEventListener('install', (e) => {
    console.log('[Service Worker] インストール完了');
});

// 通信に割り込む処理（今回は常に最新データを取るため何もしない）
self.addEventListener('fetch', (e) => {
    // オフラインキャッシュなどはせず、普通に通信させる
});