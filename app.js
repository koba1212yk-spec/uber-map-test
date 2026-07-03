import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDocs, updateDoc, increment, getDoc, addDoc, deleteDoc, query, orderBy, limit, startAfter } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { getStorage, ref, uploadString, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAYf_wpaNadUbAzKC6yq-vNk6Y_u1dyD1M",
    authDomain: "uber-map-test-31dcb.firebaseapp.com",
    projectId: "uber-map-test-31dcb",
    storageBucket: "uber-map-test-31dcb.firebasestorage.app",
    messagingSenderId: "969614644686",
    appId: "1:969614644686:web:1da7cb943b3d87d0a0c79f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

let currentUserId = "anonymous";
let myProfileName = "";
let isNameLocked = false; 

// 🌟 🆕 複数画像・編集機能用の変数に変更1
let selectedImageDataUrls = []; // 最大3枚まで保存する配列
let editingMemoId = null;       // 編集中のメモID（新規投稿ならnull）

let bbsSelectedImageDataUrl = null;
let lastBbsDoc = null; 
let currentLocationMarker = null;
let tempPinMarker = null; 
let currentOpenMemoId = null;
let targetLngLat = null; 

let isGeoZoomReady = false; // 🌟 🆕 現在地ボタンが「＋」状態かどうか

let currentGroupMemos = [];
let currentGroupIndex = 0;

let filterState = { showMineOnly: false, categories: ['🏢 建物・入口', '🅿️ 駐輪スポット', '⚠️ 注意・取締り', '🚻 トイレ・公園', '💡 その他'] };
let allMemosData = []; 

let latestMemos = [];
let tickerIndex = 0;
let isTickerFlipped = false;

// 📱 LocalStorageから直前に開いていたタブを復元 (リロード対策)
const savedTab = localStorage.getItem('deliMapActiveTab') || 'tabMap';

// 📛 読み込み中フリーズ対策：起動した瞬間、0.1秒でローカル生成した初期名前を表示する
let localName = localStorage.getItem('deliMapTempName');
if (!localName) {
    const seedId = Math.floor(1000 + Math.random() * 9000); // 被らない短い4桁
    localName = `名無し配達員(${seedId})`;
    localStorage.setItem('deliMapTempName', localName);
}
myProfileName = localName;
document.getElementById('readName').textContent = myProfileName;
document.getElementById('profileName').value = myProfileName;

// ==========================================
// 🚀 起動処理 (Firebase匿名認証)
// ==========================================
signInAnonymously(auth).then((userCredential) => {
    currentUserId = userCredential.user.uid;
    loadProfile(); // 裏でFirestoreと同期・確認を行う
}).catch(e => console.error(e));

// ==========================================
// 🗺️ MapTiler (Google Maps風)
// ==========================================
const MAPTILER_KEY = "R7X03ziyuOxnZBBvDL0G";
const map = new maplibregl.Map({
    container: 'map',
    style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`,
    center: [139.8731, 35.6635], zoom: 14, attributionControl: false 
});

map.on('load', () => {
    // 📍 起動時に自動で現在地を取得してジャンプ
    navigator.geolocation.getCurrentPosition(pos => {
        const coords = [pos.coords.longitude, pos.coords.latitude];
        map.flyTo({ center: coords, zoom: 16 });
        if (currentLocationMarker) currentLocationMarker.remove();
        const el = document.createElement('div'); el.className = 'current-location-dot';
        currentLocationMarker = new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map);
    });


     // 📍 起動時に自動で現在地を取得してジャンプ
    navigator.geolocation.getCurrentPosition(pos => {
        const coords = [pos.coords.longitude, pos.coords.latitude];
        map.flyTo({ center: coords, zoom: 16 });
        if (currentLocationMarker) currentLocationMarker.remove();
        const el = document.createElement('div'); el.className = 'current-location-dot';
        currentLocationMarker = new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map);
        
        // 🌟 🆕 初期移動が終わったら、ボタンを「＋（状態B）」にする
        setGeoZoomReady(true);
    });



    map.addSource('memos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 14, clusterRadius: 50 });

    // 1️⃣ マテリアルアイコンをマップに追加（SVG埋め込み）
    const catIcons = {
        'icon-building': '<svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" fill="%23FFFFFF"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>',
        'icon-parking': '<svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" fill="%23FFFFFF"><path d="M13.2 11H10v2h3.2c1.1 0 2-.9 2-2s-.9-2-2-2zM8 4h5.2c2.21 0 4 1.79 4 4s-1.79 4-4 4H10v8H8V4z"/></svg>',
        'icon-warning': '<svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" fill="%23FFFFFF"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
        'icon-restroom': '<svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" fill="%23FFFFFF"><path d="M20.5 6c-2.61.7-5.67 1-8.5 1s-5.89-.3-8.5-1L3 8c1.86.5 4 .83 6 1v13h2v-6h2v6h2V9c2-.17 4.14-.5 6-1l-.5-2zM12 6c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>',
        'icon-info': '<svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" fill="%23FFFFFF"><path d="M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z"/></svg>'
    };
    Object.keys(catIcons).forEach(key => {
        const img = new Image(); img.onload = () => map.addImage(key, img);
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(catIcons[key]);
    });

    // 2️⃣ クラスター
    map.addLayer({ id: 'clusters', type: 'circle', source: 'memos', filter: ['has', 'point_count'], paint: { 'circle-color': '#06C167', 'circle-radius': 18, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
    map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'memos', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 14, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#ffffff' } });
    
    // 3️⃣ 枠の色
    map.addLayer({ 
        id: 'unclustered-point', 
        type: 'circle', 
        source: 'memos', 
        filter: ['!', ['has', 'point_count']], 
        paint: { 
            'circle-opacity': ['get', 'opacity'], 
            'circle-color': [
                'case', ['get', 'isSelected'],
                [
                    'match', ['get', 'category'],
                    '🏢 建物・入口', '#1A73E8',
                    '🅿️ 駐輪スポット', '#34A853',
                    '⚠️ 注意・取締り', '#EA4335',
                    '🚻 トイレ・公園', '#FBBC04',
                    '#9AA0A6'
                ],
                '#FFFFFF'
            ], 
            'circle-radius': 16, 
            'circle-stroke-width': 3, 
            'circle-stroke-color': [
                'match', ['get', 'category'],
                '🏢 建物・入口', '#1A73E8',
                '🅿️ 駐輪スポット', '#34A853',
                '⚠️ 注意・取締り', '#EA4335',
                '🚻 トイレ・公園', '#FBBC04',
                '#9AA0A6'
            ]
        } 
    });

    // 4️⃣ アイコン
    map.addLayer({ 
        id: 'unclustered-icon', 
        type: 'symbol', 
        source: 'memos', 
        filter: ['!', ['has', 'point_count']], 
        layout: { 
            'icon-image': ['get', 'iconName'], 
            'icon-size': 0.7, 
            'icon-allow-overlap': true 
        },
        paint: {
            'icon-opacity': ['get', 'opacity'], 
            'icon-color': [
                'case', ['get', 'isSelected'],
                '#FFFFFF', 
                [
                    'match', ['get', 'category'],
                    '🏢 建物・入口', '#1A73E8',
                    '🅿️ 駐輪スポット', '#34A853',
                    '⚠️ 注意・取締り', '#EA4335',
                    '🚻 トイレ・公園', '#FBBC04',
                    '#9AA0A6'
                ]
            ]
        }
    });

    // ▼ イベント（見えない網）
    map.on('click', 'unclustered-point', (e) => {
        const bbox = [
            [e.point.x - 20, e.point.y - 20],
            [e.point.x + 20, e.point.y + 20]
        ];
        const features = map.queryRenderedFeatures(bbox, { layers: ['unclustered-point'] });
        const uniqueIds = new Set();
        currentGroupMemos = [];
        features.forEach(f => {
            if (!uniqueIds.has(f.properties.id)) {
                uniqueIds.add(f.properties.id);
                currentGroupMemos.push(f.properties);
            }
        });

        currentGroupIndex = 0;
        showCurrentGroupMemo();
    });

    map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        map.getSource('memos').getClusterExpansionZoom(features[0].properties.cluster_id, (err, zoom) => {
            if (!err) map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
        });
    });

    map.on('click', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['unclustered-point', 'unclustered-icon', 'clusters'] });
        if (!features.length) {
            const sheet = document.getElementById('memoBottomSheet');
            if (sheet.classList.contains('show')) sheet.classList.add('peek');
            document.getElementById('memoActionPanel').classList.remove('show');
            document.getElementById('filterBottomSheet').classList.remove('show');
            if (tempPinMarker) tempPinMarker.remove(); 
        }
    });

    map.on('dragstart', () => {
        const sheet = document.getElementById('memoBottomSheet');
        if (sheet.classList.contains('show')) sheet.classList.add('peek');
    });

    let touchTimer;
    map.on('touchstart', (e) => {
        if (e.originalEvent.touches.length > 1) return;
        touchTimer = setTimeout(() => { openMemoAddSheet(e.lngLat); }, 500);
    });
    map.on('touchmove', () => clearTimeout(touchTimer));
    map.on('touchend', () => clearTimeout(touchTimer));
    map.on('contextmenu', (e) => { openMemoAddSheet(e.lngLat); });

    loadMemosToMap();
    document.getElementById(savedTab).click();
});

// 🔍 検索
const searchInput = document.getElementById('addressSearchInput');
const execSearch = async () => {
    const q = searchInput.value.trim(); if (!q) return;
    try {
        const res = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${MAPTILER_KEY}&bbox=139.6,35.5,140.0,35.9`);
        const data = await res.json();
        if (data.features && data.features.length > 0) { map.flyTo({ center: data.features[0].center, zoom: 16 }); searchInput.blur(); } 
        else alert("見つかりませんでした");
    } catch (e) {}
};
searchInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') execSearch(); });

// ==========================================
// 🎯 現在地ボタン（究極の2状態トグル）
// ==========================================

function setGeoZoomReady(isReady) {
    isGeoZoomReady = isReady;
    
    // 2つのアイコンを取得
    const iconTarget = document.getElementById('geoIconTarget');
    const iconPlus = document.getElementById('geoIconPlus');

    if (iconTarget && iconPlus) {
        if (isReady) {
            // 📍 状態B: 現在地にいる時は「＋マーク」だけを表示！
            iconTarget.style.display = 'none';
            iconPlus.style.display = 'block';
        } else {
            // 📍 状態A: 地図を動かした時は「現在地マーク」だけを表示！
            iconTarget.style.display = 'block';
            iconPlus.style.display = 'none';
        }
    }
}
document.getElementById('geoBackBtn').addEventListener('click', () => {
    if (isGeoZoomReady) {
        // 📍 状態B：「＋」の時に押されたら、限界までズームして通常ボタンに戻す
        map.flyTo({ zoom: 20, duration: 800 });
        setGeoZoomReady(false);
    } else {
        // 📍 状態A：通常時に押されたら、現在地に戻り「＋」状態にする
        navigator.geolocation.getCurrentPosition(pos => {
            const coords = [pos.coords.longitude, pos.coords.latitude];
            map.flyTo({ center: coords, zoom: 16, duration: 800 });
            if (currentLocationMarker) currentLocationMarker.remove();
            const el = document.createElement('div'); el.className = 'current-location-dot';
            currentLocationMarker = new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map);
            
            setGeoZoomReady(true);
        });
    }
});

// 🔄 ユーザーが自分で地図を動かしたら、即座にボタンを通常状態（状態A）に戻す
map.on('dragstart', (e) => {
    if (e.originalEvent) setGeoZoomReady(false); // 指でのスワイプのみ検知
});
map.on('zoomstart', (e) => {
    if (e.originalEvent) setGeoZoomReady(false); // 指でのピンチ操作のみ検知
});

// 📱 タブ切り替え
const tabs = { 'tabMap': 'mapPage', 'tabBbs': 'bbsPage', 'tabProfile': 'profilePage' };
Object.keys(tabs).forEach(tabId => {
    document.getElementById(tabId).addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
        document.querySelectorAll('.page-section').forEach(p => p.style.display = 'none');
        document.getElementById(tabs[tabId]).style.display = 'block';
        localStorage.setItem('deliMapActiveTab', tabId);
        if(tabId === 'tabMap') map.resize();
        if(tabId === 'tabBbs' && lastBbsDoc === null) loadBbsTimeline(false);
    });
});

// ==========================================
// 📻 3D回転ティッカー
// ==========================================
setInterval(() => {
    if (latestMemos.length === 0) return;
    const content = document.getElementById('tickerContent');
    const backFace = document.getElementById('tickerBack');
    if (isTickerFlipped) {
        content.classList.remove('flipped');
        tickerIndex = (tickerIndex + 1) % latestMemos.length; 
    } else {
        const memo = latestMemos[tickerIndex];
        const emoji = memo.category ? memo.category.substring(0, 2) : "📝";
        backFace.textContent = `${emoji} ${memo.text || memo.category}`;
        content.classList.add('flipped');
    }
    isTickerFlipped = !isTickerFlipped;
}, 3500);

document.getElementById('tickerClickArea').addEventListener('click', () => {
    if (latestMemos.length === 0) return;
    const targetMemo = isTickerFlipped ? latestMemos[tickerIndex] : latestMemos[(tickerIndex === 0 ? latestMemos.length - 1 : tickerIndex - 1)];
    map.flyTo({ center: [targetMemo.lng, targetMemo.lat], zoom: 16 });
    openMemoBottomSheet(targetMemo);
});

// ==========================================
// ⚙️ プロフィール設定
// ==========================================
async function loadProfile() {
    try {
        const snap = await getDoc(doc(db, "profiles", currentUserId));
        if (snap.exists()) {
            const pData = snap.data();
            myProfileName = pData.displayName || myProfileName;
            isNameLocked = pData.nameChanged || false;

            document.getElementById('readName').textContent = myProfileName;
            document.getElementById('profileName').value = myProfileName;
            
            if (isNameLocked) {
                document.getElementById('nameChangeWarning').style.display = 'none';
                document.getElementById('profileName').disabled = true;
            }
            
            document.getElementById('readArea').textContent = pData.mainArea || "未設定"; document.getElementById('readTime').textContent = pData.mainTime || "未設定";
            document.getElementById('readTotalLikes').textContent = pData.totalLikes || 0;
            const tagsContainer = document.getElementById('readTags'); tagsContainer.innerHTML = ""; 
            const allTags = [...(pData.vehicles || []), ...(pData.services || [])];
            if (allTags.length === 0) tagsContainer.innerHTML = "<span style='font-size:0.85em; color:#71767B;'>未設定</span>"; 
            else allTags.forEach(tag => { const span = document.createElement('span'); span.className = 'tag'; span.textContent = tag; tagsContainer.appendChild(span); });
            document.getElementById('profileArea').value = pData.mainArea || ""; document.getElementById('profileTime').value = pData.mainTime || "";
            document.querySelectorAll('input[name="vehicleTag"]').forEach(cb => cb.checked = pData.vehicles?.includes(cb.value)); document.querySelectorAll('input[name="serviceTag"]').forEach(cb => cb.checked = pData.services?.includes(cb.value));
        } else {
            await setDoc(doc(db, "profiles", currentUserId), { displayName: myProfileName, nameChanged: false }, { merge: true });
        }
    } catch (e) {}
}

document.getElementById('editProfileBtn').addEventListener('click', () => { document.getElementById('profileReadMode').style.display = 'none'; document.getElementById('profileEditMode').style.display = 'block'; });
document.getElementById('cancelEditBtn').addEventListener('click', () => { document.getElementById('profileEditMode').style.display = 'none'; document.getElementById('profileReadMode').style.display = 'block'; });
document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    let finalName = document.getElementById('profileName').value.trim() || myProfileName;
    const area = document.getElementById('profileArea').value.trim(); const time = document.getElementById('profileTime').value.trim();
    const vehicles = Array.from(document.querySelectorAll('input[name="vehicleTag"]:checked')).map(el => el.value); const services = Array.from(document.querySelectorAll('input[name="serviceTag"]:checked')).map(el => el.value);
    
    let lockFlag = isNameLocked;
    if (!isNameLocked && finalName !== myProfileName) lockFlag = true;

    try { 
        await setDoc(doc(db, "profiles", currentUserId), { displayName: finalName, mainArea: area, mainTime: time, vehicles: vehicles, services: services, nameChanged: lockFlag, updatedAt: new Date() }, { merge: true }); 
        localStorage.setItem('deliMapTempName', finalName); 
        await loadProfile(); document.getElementById('profileEditMode').style.display = 'none'; document.getElementById('profileReadMode').style.display = 'block'; 
    } catch (error) {}
});
document.getElementById('submitOpinionBtn').addEventListener('click', async () => { 
    const text = document.getElementById('opinionInput').value.trim(); if (!text) return; 
    try { await addDoc(collection(db, "opinions"), { text: text, senderId: currentUserId, createdAt: new Date() }); alert('送信完了！'); document.getElementById('opinionInput').value = ""; } catch (e) {} 
});

// ==========================================
// 📝 攻略メモ (複数画像・編集・通報対応)
// ==========================================
function compressImage(file, maxWidth = 800) {
    return new Promise((resolve) => {
        const reader = new FileReader(); reader.onload = (e) => {
            const img = new Image(); img.onload = () => {
                const canvas = document.createElement('canvas'); let width = img.width; let height = img.height;
                if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
                canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(img, 0, 0, width, height); resolve(canvas.toDataURL('image/jpeg', 0.7)); 
            }; img.src = e.target.result;
        }; reader.readAsDataURL(file);
    });
}

const filterCats = ['🏢 建物・入口', '🅿️ 駐輪スポット', '⚠️ 注意・取締り', '🚻 トイレ・公園', '💡 その他'];
const filterContainer = document.getElementById('filterCategoryContainer');
filterCats.forEach(cat => { filterContainer.innerHTML += `<label class="cat-chip"><input type="checkbox" value="${cat}" checked><span>${cat.substring(0, 2)} ${cat.substring(3)}</span></label>`; });

document.getElementById('btnFilterMemo').addEventListener('click', () => {
    document.getElementById('memoBottomSheet').classList.remove('show');
    document.getElementById('memoActionPanel').classList.remove('show');
    document.getElementById('filterBottomSheet').classList.add('show');
});
document.getElementById('btnCloseFilter').addEventListener('click', () => { document.getElementById('filterBottomSheet').classList.remove('show'); });

document.getElementById('chkShowMineOnly').addEventListener('change', () => { filterState.showMineOnly = document.getElementById('chkShowMineOnly').checked; applyFilters(); });
filterContainer.addEventListener('change', () => { filterState.categories = Array.from(filterContainer.querySelectorAll('input:checked')).map(cb => cb.value); applyFilters(); });

// 📍 新規登録用ピン
function openMemoAddSheet(lngLat) {
    targetLngLat = lngLat; 
    editingMemoId = null; // 新規なのでリセット
    if (tempPinMarker) tempPinMarker.remove();
    
    const wrapper = document.createElement('div'); 
    const pin = document.createElement('div');     
    pin.className = 'sharp-temp-pin';
    wrapper.appendChild(pin);
    tempPinMarker = new maplibregl.Marker({ element: wrapper, anchor: 'bottom' }).setLngLat(lngLat).addTo(map);

    map.easeTo({ center: lngLat, padding: { top: 90, bottom: 450, left: 0, right: 0 }, duration: 350 });
    document.getElementById('memoBottomSheet').classList.remove('show');
    document.getElementById('filterBottomSheet').classList.remove('show');
    document.getElementById('memoActionPanel').classList.add('show');
}

// 🌟 パネルを閉じる時（編集状態なども完全リセット）
const closeMemoForm = () => { 
    document.getElementById('memoActionPanel').classList.remove('show'); 
    document.getElementById('btnRemoveImage').click(); 
    document.getElementById('memoTextInput').value = ""; 
    editingMemoId = null; 
    if (tempPinMarker) tempPinMarker.remove(); 
};
document.getElementById('btnCancelForm').addEventListener('click', closeMemoForm);

// 🌟 画像追加処理（最大3枚まで配列に格納）
async function handleMemoImage(file, btnTextId, defaultText) {
    if (!file) return; 
    if (selectedImageDataUrls.length >= 3) {
        alert("画像は最大3枚までです"); return;
    }

    document.getElementById(btnTextId).textContent = "⏳ 圧縮中"; 
    const compressedData = await compressImage(file);
    selectedImageDataUrls.push(compressedData); // 配列に追加

    document.getElementById('memoImagePreview').src = selectedImageDataUrls[selectedImageDataUrls.length - 1]; // 最新を表示
    document.getElementById('memoImagePreviewContainer').style.display = 'block'; 
    
    // ガイド用テキストの追加
    let countLabel = document.getElementById('memoImageCountLabel');
    if(!countLabel) {
        countLabel = document.createElement('div');
        countLabel.id = 'memoImageCountLabel';
        countLabel.style.textAlign = 'center';
        countLabel.style.fontSize = '12px';
        countLabel.style.color = '#1A73E8';
        countLabel.style.fontWeight = 'bold';
        countLabel.style.marginTop = '4px';
        document.getElementById('memoImagePreviewContainer').appendChild(countLabel);
    }
    countLabel.textContent = `${selectedImageDataUrls.length}枚選択中 (最大3枚)`;

    // 3枚に達したらボタンを隠す
    if (selectedImageDataUrls.length >= 3) {
        document.getElementById('memoCameraBtnText').parentNode.style.display = 'none'; 
        document.getElementById('memoImageBtnText').parentNode.style.display = 'none'; 
    }
    document.getElementById(btnTextId).textContent = defaultText;
}

document.getElementById('memoCameraInput').addEventListener('change', (e) => handleMemoImage(e.target.files[0], 'memoCameraBtnText', '📷 撮影')); 
document.getElementById('memoImageInput').addEventListener('change', (e) => handleMemoImage(e.target.files[0], 'memoImageBtnText', '📁 画像'));

// 画像クリア（全消去）
document.getElementById('btnRemoveImage').addEventListener('click', () => { 
    selectedImageDataUrls = []; 
    document.getElementById('memoImageInput').value = ""; 
    document.getElementById('memoCameraInput').value = ""; 
    document.getElementById('memoImagePreviewContainer').style.display = 'none'; 
    document.getElementById('memoCameraBtnText').parentNode.style.display = 'inline-block'; 
    document.getElementById('memoImageBtnText').parentNode.style.display = 'inline-block'; 
    const countLabel = document.getElementById('memoImageCountLabel');
    if(countLabel) countLabel.textContent = "";
});

// 🌟 投稿・更新ボタン（配列画像をすべてアップロード）
document.getElementById('btnSaveMemo').addEventListener('click', async () => {
    const text = document.getElementById('memoTextInput').value.trim(); 
    if (!text && selectedImageDataUrls.length === 0) { alert("入力必須です"); return; }
    
    const catInput = document.querySelector('input[name="memoCatInput"]:checked'); 
    const category = catInput ? catInput.value : '💡 その他';
    const isShowName = document.getElementById('chkShowName').checked; 
    const finalSenderName = isShowName ? myProfileName : "匿名ドライバー";
    const saveBtn = document.getElementById('btnSaveMemo'); 
    saveBtn.disabled = true; saveBtn.textContent = "⏳ 送信中";
    
    try {
        let finalUrls = []; 
        for (let i = 0; i < selectedImageDataUrls.length; i++) {
            const dataUrl = selectedImageDataUrls[i];
            if (dataUrl.startsWith('http')) {
                finalUrls.push(dataUrl); // 編集で既にアップロード済みのURLはそのまま
            } else {
                const storageRef = ref(storage, `memos/${Date.now()}_${currentUserId}_${i}.jpg`); 
                await uploadString(storageRef, dataUrl, 'data_url'); 
                finalUrls.push(await getDownloadURL(storageRef)); 
            }
        }
        
        const memoData = { 
            lat: targetLngLat.lat, lng: targetLngLat.lng, 
            category: category, text: text, 
            imageUrls: finalUrls, // 🌟 配列として保存
            imageUrl: finalUrls.length > 0 ? finalUrls[0] : null, // 念のため1枚目も古い形式で残す
            senderId: currentUserId, senderName: finalSenderName, 
            updatedAt: Date.now() 
        };

        if (editingMemoId) {
            // 📝 既存のメモをアップデート
            await updateDoc(doc(db, "memos", editingMemoId), memoData);
        } else {
            // 📝 新規作成
            memoData.likesCount = 0;
            memoData.reportCount = 0;
            memoData.createdAt = Date.now();
            await addDoc(collection(db, "memos"), memoData);
        }
        
        closeMemoForm(); await loadMemosToMap();
    } catch (e) { alert("エラーが発生しました"); } finally { saveBtn.disabled = false; saveBtn.textContent = "投稿する"; }
});

async function loadMemosToMap() {
    const q = query(collection(db, "memos"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    allMemosData = [];
    latestMemos = []; 
    
    let count = 0;
    snap.forEach(docSnap => {
        const data = { id: docSnap.id, ...docSnap.data() };
        allMemosData.push(data);
        if (count < 3) { latestMemos.push(data); count++; } 
    });
    applyFilters();
}

function applyFilters() {
    if (!map.getSource('memos')) return;
    const features = [];
    const usedCoords = []; 

    allMemosData.forEach(data => {
        if (filterState.showMineOnly && data.senderId !== currentUserId) return;
        if (!filterState.categories.includes(data.category)) return;
        
        let iconId = 'icon-info';
        if (data.category === '🏢 建物・入口') iconId = 'icon-building';
        else if (data.category === '🅿️ 駐輪スポット') iconId = 'icon-parking';
        else if (data.category === '⚠️ 注意・取締り') iconId = 'icon-warning';
        else if (data.category === '🚻 トイレ・公園') iconId = 'icon-restroom';

        const isSelected = data.id === currentOpenMemoId;

        let displayLng = data.lng;
        let displayLat = data.lat;
        if (!isSelected) {
            let overlapCount = 0;
            for (let c of usedCoords) {
                const dist = Math.sqrt(Math.pow(c.lng - displayLng, 2) + Math.pow(c.lat - displayLat, 2));
                if (dist < 0.00005) overlapCount++; 
            }
            if (overlapCount > 0) {
                displayLng += overlapCount * 0.000012; // ちょっとだけズラす
                displayLat += overlapCount * 0.000012;
            }
            usedCoords.push({lng: displayLng, lat: displayLat});
        }

        let pinOpacity = 1.0;
       

        features.push({
            type: 'Feature', geometry: { type: 'Point', coordinates: [displayLng, displayLat] },
            properties: { 
                id: data.id, iconName: iconId, category: data.category, 
                lng: data.lng, lat: data.lat, isSelected: isSelected, opacity: pinOpacity 
            }
        });
    });

    features.sort((a, b) => {
        if (a.properties.isSelected) return 1; 
        if (b.properties.isSelected) return -1;
        return 0;
    });

    map.getSource('memos').setData({ type: 'FeatureCollection', features: features });
}

function showCurrentGroupMemo() {
    if (currentGroupMemos.length === 0) return;
    const targetMemo = currentGroupMemos[currentGroupIndex];
    openMemoBottomSheet(targetMemo);

    const navBar = document.getElementById('memoGroupNav');
    if (navBar) {
        if (currentGroupMemos.length > 1) {
            navBar.style.display = 'flex';
            document.getElementById('textGroupCount').textContent = `付近に${currentGroupMemos.length}件のメモ (${currentGroupIndex + 1}/${currentGroupMemos.length})`;
        } else {
            navBar.style.display = 'none';
        }
    }
}

// 🌟 ボトムシート展開＆データ流し込み（カルーセル・権限管理含む）
function openMemoBottomSheet(props) {
    currentOpenMemoId = props.id;
    applyFilters(); 
    
    // allMemosDataからフルデータを引っ張ってくる
    const fullData = allMemosData.find(m => m.id === props.id);
    if(!fullData) return;

    document.getElementById('sheetCategory').textContent = fullData.category;
    document.getElementById('sheetText').textContent = fullData.text;
    
    const diffMin = Math.floor((Date.now() - fullData.createdAt) / 60000);
    let timeStr = "たった今";
    if (diffMin >= 60 * 24) timeStr = `${Math.floor(diffMin / (60 * 24))}日前`;
    else if (diffMin >= 60) timeStr = `${Math.floor(diffMin / 60)}時間前`;
    else if (diffMin > 0) timeStr = `${diffMin}分前`;
    document.getElementById('sheetTime').textContent = timeStr;
    
    document.getElementById('sheetAuthorName').textContent = fullData.senderName;
    document.getElementById('sheetLikeCount').textContent = fullData.likesCount || 0;
    if (document.getElementById('sheetReportCount')) document.getElementById('sheetReportCount').textContent = fullData.reportCount || 0;

    // 🌟 管理ボタン（編集・削除）の表示切り替え
    const manageBtns = document.getElementById('sheetManageButtons');
    if (manageBtns) manageBtns.style.display = (fullData.senderId === currentUserId) ? 'flex' : 'none';

    document.getElementById('sheetAuthorContainer').onclick = () => { if (fullData.senderName !== "匿名ドライバー") openProfileModal(fullData.senderId, fullData.senderName); };
    
    // 📸 カルーセルの構築
    const imgContainer = document.getElementById('sheetImageContainer');
    const scrollArea = document.getElementById('sheetImageScroll');
    const dotsArea = document.getElementById('carouselDots');
    const counterLabel = document.getElementById('carouselCounter');
    let bottomPadding = 300; 

    // 配列が存在すればそれを、無ければ古い形式の1枚を取得
    let images = fullData.imageUrls || (fullData.imageUrl ? [fullData.imageUrl] : []);

    if(images.length > 0) { 
        imgContainer.style.display = 'block'; 
        bottomPadding = 520; 
        scrollArea.innerHTML = '';
        dotsArea.innerHTML = '';

        images.forEach((url, idx) => {
            const img = document.createElement('img');
            img.src = url;
            img.onclick = () => openImageViewer(url);
            scrollArea.appendChild(img);

            const dot = document.createElement('div');
            dot.className = 'dot' + (idx === 0 ? ' active' : '');
            dotsArea.appendChild(dot);
        });

        if (images.length > 1) {
            counterLabel.style.display = 'block';
            counterLabel.textContent = `1 / ${images.length}`;
            dotsArea.style.display = 'flex';
            
            // スクロール時にドットと数字を更新
            scrollArea.onscroll = () => {
                const scrollLeft = scrollArea.scrollLeft;
                const width = scrollArea.clientWidth;
                const index = Math.round(scrollLeft / width);
                
                counterLabel.textContent = `${index + 1} / ${images.length}`;
                const dots = dotsArea.querySelectorAll('.dot');
                dots.forEach((d, i) => {
                    if (i === index) d.classList.add('active'); else d.classList.remove('active');
                });
            };
        } else {
            counterLabel.style.display = 'none';
            dotsArea.style.display = 'none';
        }
    } else { 
        imgContainer.style.display = 'none'; 
    }

    map.easeTo({ center: [fullData.lng, fullData.lat], padding: { top: 90, bottom: bottomPadding, left: 0, right: 0 }, duration: 350 });
    document.getElementById('memoActionPanel').classList.remove('show');
    document.getElementById('filterBottomSheet').classList.remove('show');
    const sheet = document.getElementById('memoBottomSheet');
    sheet.classList.remove('peek'); 
    sheet.classList.add('show');
}

// 🌟 いいね・通報・編集・削除 ボタンのイベント
document.getElementById('btnLikeMemo')?.addEventListener('click', async () => {
    if(!currentOpenMemoId) return;
    try {
        await updateDoc(doc(db, "memos", currentOpenMemoId), { likesCount: increment(1) });
        const memoSnap = await getDoc(doc(db, "memos", currentOpenMemoId));
        if(memoSnap.exists()) { const targetId = memoSnap.data().senderId; await setDoc(doc(db, "profiles", targetId), { totalLikes: increment(1) }, { merge: true }); }
        document.getElementById('sheetLikeCount').textContent = parseInt(document.getElementById('sheetLikeCount').textContent) + 1;
        loadMemosToMap();
    } catch(e) {}
});

document.getElementById('btnReportMemo')?.addEventListener('click', async () => {
    if(!currentOpenMemoId || !confirm("このメモを通報しますか？")) return;
    try {
        await updateDoc(doc(db, "memos", currentOpenMemoId), { reportCount: increment(1) });
        document.getElementById('sheetReportCount').textContent = parseInt(document.getElementById('sheetReportCount').textContent || 0) + 1;
        alert("通報しました。ご協力ありがとうございます。");
        loadMemosToMap();
    } catch(e) {}
});

document.getElementById('btnDeleteMemo')?.addEventListener('click', async () => {
    if(!currentOpenMemoId || !confirm("削除しますか？")) return;
    await deleteDoc(doc(db, "memos", currentOpenMemoId));
    document.getElementById('memoBottomSheet').classList.remove('show');
    const navBar = document.getElementById('memoGroupNav'); if (navBar) navBar.style.display = 'none';
    loadMemosToMap();
});

// 🌟 編集ボタン（パネルを呼び出してデータをセット）
document.getElementById('btnEditMemo')?.addEventListener('click', () => {
    const memoData = allMemosData.find(m => m.id === currentOpenMemoId);
    if(!memoData) return;
    
    editingMemoId = currentOpenMemoId;
    targetLngLat = { lat: memoData.lat, lng: memoData.lng };
    
    document.getElementById('memoTextInput').value = memoData.text || "";
    const catInputs = document.querySelectorAll('input[name="memoCatInput"]');
    catInputs.forEach(input => { if (input.value === memoData.category) input.checked = true; });

    // 既存画像のセット
    selectedImageDataUrls = memoData.imageUrls || (memoData.imageUrl ? [memoData.imageUrl] : []);
    if (selectedImageDataUrls.length > 0) {
        document.getElementById('memoImagePreview').src = selectedImageDataUrls[0]; 
        document.getElementById('memoImagePreviewContainer').style.display = 'block';
        
        let countLabel = document.getElementById('memoImageCountLabel');
        if(!countLabel) {
            countLabel = document.createElement('div'); countLabel.id = 'memoImageCountLabel';
            countLabel.style.textAlign = 'center'; countLabel.style.fontSize = '12px'; countLabel.style.color = '#1A73E8'; countLabel.style.fontWeight = 'bold'; countLabel.style.marginTop = '4px';
            document.getElementById('memoImagePreviewContainer').appendChild(countLabel);
        }
        countLabel.textContent = `${selectedImageDataUrls.length}枚選択中 (最大3枚)`;

        if (selectedImageDataUrls.length < 3) {
            document.getElementById('memoCameraBtnText').parentNode.style.display = 'inline-block'; 
            document.getElementById('memoImageBtnText').parentNode.style.display = 'inline-block'; 
        } else {
            document.getElementById('memoCameraBtnText').parentNode.style.display = 'none'; 
            document.getElementById('memoImageBtnText').parentNode.style.display = 'none'; 
        }
    } else {
        document.getElementById('btnRemoveImage').click();
    }

    document.getElementById('memoBottomSheet').classList.remove('show');
    document.getElementById('memoBottomSheet').classList.remove('peek');
    document.getElementById('memoActionPanel').classList.add('show');
    
    map.easeTo({ center: targetLngLat, padding: { top: 90, bottom: 450, left: 0, right: 0 }, duration: 350 });
    
    if (tempPinMarker) tempPinMarker.remove();
    const wrapper = document.createElement('div'); const pin = document.createElement('div'); pin.className = 'sharp-temp-pin'; wrapper.appendChild(pin);
    tempPinMarker = new maplibregl.Marker({ element: wrapper, anchor: 'bottom' }).setLngLat(targetLngLat).addTo(map);
});


async function openProfileModal(targetId, targetName) {
    document.getElementById('modalName').textContent = targetName;
    document.getElementById('modalArea').textContent = "読込中..."; document.getElementById('modalTime').textContent = "読込中..."; document.getElementById('modalLikesCount').textContent = "-"; document.getElementById('modalTags').innerHTML = "";
    document.getElementById('profileModalOverlay').style.display = 'block'; document.getElementById('profileModal').style.display = 'block';
    try {
        const snap = await getDoc(doc(db, "profiles", targetId));
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('modalArea').textContent = data.mainArea || "未設定"; document.getElementById('modalTime').textContent = data.mainTime || "未設定"; document.getElementById('modalLikesCount').textContent = data.totalLikes || 0;
            const tags = [...(data.vehicles || []), ...(data.services || [])];
            if(tags.length) tags.forEach(t => { const span = document.createElement('span'); span.className='tag'; span.textContent=t; document.getElementById('modalTags').appendChild(span); });
        }
    } catch(e) {}
}
document.getElementById('closeModalBtn').addEventListener('click', () => { document.getElementById('profileModalOverlay').style.display = 'none'; document.getElementById('profileModal').style.display = 'none'; });
document.getElementById('profileModalOverlay').addEventListener('click', () => { document.getElementById('profileModalOverlay').style.display = 'none'; document.getElementById('profileModal').style.display = 'none'; });

// ==========================================
// 🕊️ 匿名掲示板 (完全維持)
// ==========================================
const avatarEmojis = ['🛵', '🚲', '🍔', '🐱', '🕶️'];
const avatarColors = ['#1d9bf0', '#00ba7c', '#f91880', '#ff7a00', '#7856ff'];

document.getElementById('fabPostBtn').addEventListener('click', () => { document.getElementById('bbsComposePage').style.display = 'flex'; });
document.getElementById('btnCancelBbs').addEventListener('click', () => { document.getElementById('bbsComposePage').style.display = 'none'; document.getElementById('btnRemoveBbsImage').click(); document.getElementById('bbsTextInput').value = ""; });

async function handleBbsImage(file) {
    if (!file) return; document.getElementById('bbsCompressStatus').textContent = "⏳ 圧縮中";
    bbsSelectedImageDataUrl = await compressImage(file); document.getElementById('bbsImagePreview').src = bbsSelectedImageDataUrl;
    document.getElementById('bbsImagePreviewContainer').style.display = 'block'; document.getElementById('bbsCompressStatus').textContent = "📸 完了";
}
document.getElementById('bbsCameraInput').addEventListener('change', (e) => handleBbsImage(e.target.files[0]));
document.getElementById('bbsImageInput').addEventListener('change', (e) => handleBbsImage(e.target.files[0]));
document.getElementById('btnRemoveBbsImage').addEventListener('click', () => { bbsSelectedImageDataUrl = null; document.getElementById('bbsCameraInput').value = ""; document.getElementById('bbsImageInput').value = ""; document.getElementById('bbsImagePreviewContainer').style.display = 'none'; document.getElementById('bbsCompressStatus').textContent = ""; });

document.getElementById('btnPostBbs').addEventListener('click', async () => {
    const text = document.getElementById('bbsTextInput').value.trim(); if (!text && !bbsSelectedImageDataUrl) return;
    const postBtn = document.getElementById('btnPostBbs'); postBtn.disabled = true;
    try {
        let finalUrl = null; let finalPath = null;
        if (bbsSelectedImageDataUrl) { finalPath = `bbs_images/${Date.now()}_anon.jpg`; const storageRef = ref(storage, finalPath); await uploadString(storageRef, bbsSelectedImageDataUrl, 'data_url'); finalUrl = await getDownloadURL(storageRef); }
        await addDoc(collection(db, "bbs"), { text: text, imageUrl: finalUrl, imagePath: finalPath, createdAt: new Date(), avatarId: Math.floor(Math.random() * 5), rxHandshake: 0, rxCoffee: 0, rxBulb: 0 });
        document.getElementById('btnCancelBbs').click(); 
        const allSnap = await getDocs(query(collection(db, "bbs"), orderBy("createdAt", "desc")));
        if (allSnap.size > 100) {
            for (let i = 100; i < allSnap.size; i++) {
                const oldDoc = allSnap.docs[i]; const oldData = oldDoc.data();
                if (oldData.imagePath) { try { await deleteObject(ref(storage, oldData.imagePath)); } catch (e) {} }
                await deleteDoc(oldDoc.ref);
            }
        }
        await loadBbsTimeline(false);
    } catch (e) { alert("エラーが発生しました"); } finally { postBtn.disabled = false; }
});

async function loadBbsTimeline(isMore = false) {
    const bbsList = document.getElementById('bbsList'); const moreBtn = document.getElementById('btnLoadMoreBbs');
    if (!isMore) { bbsList.innerHTML = ""; lastBbsDoc = null; }
    let q = isMore && lastBbsDoc ? query(collection(db, "bbs"), orderBy("createdAt", "desc"), startAfter(lastBbsDoc), limit(20)) : query(collection(db, "bbs"), orderBy("createdAt", "desc"), limit(20));
    const snapshot = await getDocs(q);
    if (snapshot.empty) { if (!isMore) bbsList.innerHTML = "<p style='text-align:center; color:#71767B; padding:40px;'>ポストがありません</p>"; moreBtn.style.display = "none"; return; }
    lastBbsDoc = snapshot.docs[snapshot.docs.length - 1];

    snapshot.forEach((docSnap) => {
        const id = docSnap.id; const data = docSnap.data(); const card = document.createElement('div'); card.className = "bbs-card";
        let timeStr = ""; if (data.createdAt) { const d = data.createdAt.toDate(); timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
        const aId = data.avatarId || 0;
        card.innerHTML = `<div class="bbs-avatar-column"><div class="bbs-avatar" style="background-color: ${avatarColors[aId]};">${avatarEmojis[aId]}</div></div>
            <div class="bbs-card-content"><div class="bbs-card-meta"><span class="bbs-user-name">匿名ドライバー</span><span class="bbs-time-stamp">@kasai_driver · ${timeStr}</span></div><div class="bbs-card-text">${data.text || ""}</div>${data.imageUrl ? `<img src="${data.imageUrl}" class="bbs-card-image" onclick="openImageViewer('${data.imageUrl}')">` : ""}<div class="bbs-reactions-bar"><div class="bbs-reaction" id="rx-handshake-${id}"><span class="rx-icon">🤝</span> <span class="rx-count">${data.rxHandshake || 0}</span></div><div class="bbs-reaction" id="rx-coffee-${id}"><span class="rx-icon">☕</span> <span class="rx-count">${data.rxCoffee || 0}</span></div><div class="bbs-reaction" id="rx-bulb-${id}"><span class="rx-icon">💡</span> <span class="rx-count">${data.rxBulb || 0}</span></div></div></div>`;
        bbsList.appendChild(card);
        const attachReaction = (type, key) => {
            const el = card.querySelector(`#rx-${type}-${id}`);
            el.addEventListener('click', async () => {
                if (el.classList.contains('acted')) return; el.classList.add('acted');
                el.querySelector('.rx-count').textContent = parseInt(el.querySelector('.rx-count').textContent) + 1;
                try { await updateDoc(doc(db, "bbs", id), { [key]: increment(1) }); } catch (e) {}
            });
        };
        attachReaction('handshake', 'rxHandshake'); attachReaction('coffee', 'rxCoffee'); attachReaction('bulb', 'rxBulb');
    });
    moreBtn.style.display = snapshot.size === 20 ? "block" : "none";
}
document.getElementById('btnLoadMoreBbs').addEventListener('click', () => loadBbsTimeline(true));

window.openImageViewer = (url) => { document.getElementById('fullSizeImage').src = url; document.getElementById('imageViewerOverlay').style.display = 'block'; document.getElementById('imageViewerModal').style.display = 'block'; };
const closeViewer = () => { document.getElementById('imageViewerOverlay').style.display = 'none'; document.getElementById('imageViewerModal').style.display = 'none'; };
document.getElementById('closeImageViewerBtn').addEventListener('click', closeViewer); document.getElementById('imageViewerOverlay').addEventListener('click', closeViewer);


// ==========================================
// 📱 🌟 複数メモの矢印スワイプ操作
// ==========================================
const btnGroupPrev = document.getElementById('btnGroupPrev');
const btnGroupNext = document.getElementById('btnGroupNext');

if (btnGroupPrev) {
    btnGroupPrev.addEventListener('click', () => {
        if (currentGroupIndex > 0) {
            currentGroupIndex--;
            showCurrentGroupMemo();
        }
    });
}
if (btnGroupNext) {
    btnGroupNext.addEventListener('click', () => {
        if (currentGroupIndex < currentGroupMemos.length - 1) {
            currentGroupIndex++;
            showCurrentGroupMemo();
        }
    });
}

// ==========================================
// 📱 シートのスワイプ操作＆✕ボタン (Google Maps風UX)
// ==========================================
const memoSheet = document.getElementById('memoBottomSheet');
let touchStartY = 0;

memoSheet.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
}, { passive: true });

memoSheet.addEventListener('touchend', (e) => {
    const touchEndY = e.changedTouches[0].clientY;
    const diff = touchEndY - touchStartY;

    if (diff > 50 && memoSheet.classList.contains('show') && !memoSheet.classList.contains('peek')) {
        if (memoSheet.scrollTop === 0) {
            memoSheet.classList.add('peek');
        }
    } 
    else if (diff < -50 && memoSheet.classList.contains('peek')) {
        memoSheet.classList.remove('peek');
    }
});

memoSheet.addEventListener('click', (e) => {
    if (e.target.id !== 'btnCloseMemoSheet' && !e.target.classList.contains('btn-group-nav') && memoSheet.classList.contains('peek')) {
        memoSheet.classList.remove('peek');
    }
});

const btnCloseSheet = document.getElementById('btnCloseMemoSheet');
if (btnCloseSheet) {
    btnCloseSheet.addEventListener('click', (e) => {
        e.stopPropagation(); 
        memoSheet.classList.remove('show');
        memoSheet.classList.remove('peek');
        
        const navBar = document.getElementById('memoGroupNav');
        if (navBar) navBar.style.display = 'none';

        currentOpenMemoId = null;
        applyFilters();
    });
}