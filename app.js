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
let myProfileName = "名無し配達員";
let selectedImageDataUrl = null;
let bbsSelectedImageDataUrl = null;
let lastBbsDoc = null; 
let currentLocationMarker = null;
let currentOpenMemoId = null;
let targetLngLat = null; // 長押しした座標保持用

// 🆕 フィルター用ステータス
let filterState = {
    showMineOnly: false,
    categories: ['🏢 建物・入口', '🅿️ 駐輪スポット', '⚠️ 注意・取締り', '🚻 トイレ・公園', '💡 その他']
};
let allMemosData = []; // DBから取得した全データを保持

// ==========================================
// 🚀 起動処理 (Firebase匿名認証)
// ==========================================
signInAnonymously(auth).then((userCredential) => {
    currentUserId = userCredential.user.uid;
    loadProfile();
}).catch(e => console.error(e));

// ==========================================
// 🗺️ MapTiler (Google Maps風)
// ==========================================
const MAPTILER_KEY = "R7X03ziyuOxnZBBvDL0G";
const map = new maplibregl.Map({
    container: 'map',
    style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`,
    center: [139.8731, 35.6635], // 葛西
    zoom: 14,
    attributionControl: false 
});

map.on('load', () => {
    // 🟢 メモ用 GeoJSONソース (クラスタリング)
    map.addSource('memos', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50
    });

    map.addLayer({
        id: 'clusters', type: 'circle', source: 'memos', filter: ['has', 'point_count'],
        paint: { 'circle-color': '#06C167', 'circle-radius': 18, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
    });
    map.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'memos', filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 14, 'text-font': ['Noto Sans Bold'] },
        paint: { 'text-color': '#ffffff' }
    });

    map.addLayer({
        id: 'unclustered-point', type: 'circle', source: 'memos', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': '#FFFFFF', 'circle-radius': 16, 'circle-stroke-width': 2, 'circle-stroke-color': '#06C167' }
    });
    map.addLayer({
        id: 'unclustered-emoji', type: 'symbol', source: 'memos', filter: ['!', ['has', 'point_count']],
        layout: { 'text-field': ['get', 'emoji'], 'text-size': 18, 'text-anchor': 'center' }
    });

    // ボトムシート展開
    map.on('click', 'unclustered-point', (e) => openMemoBottomSheet(e.features[0].properties));
    map.on('click', 'unclustered-emoji', (e) => openMemoBottomSheet(e.features[0].properties));
    
    // クラスターズーム
    map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0].properties.cluster_id;
        map.getSource('memos').getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
        });
    });

    // 余白タップでシート閉じる
    map.on('click', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['unclustered-point', 'unclustered-emoji', 'clusters'] });
        if (!features.length) {
            document.getElementById('memoBottomSheet').classList.remove('show');
            document.getElementById('memoActionPanel').classList.remove('show');
            document.getElementById('filterBottomSheet').classList.remove('show');
        }
    });

    // 👆 長押し（ロングタップ）でメモ追加パネルを展開
    let touchTimer;
    map.on('touchstart', (e) => {
        if (e.originalEvent.touches.length > 1) return;
        touchTimer = setTimeout(() => { openMemoAddSheet(e.lngLat); }, 500);
    });
    map.on('touchmove', () => clearTimeout(touchTimer));
    map.on('touchend', () => clearTimeout(touchTimer));
    map.on('contextmenu', (e) => { openMemoAddSheet(e.lngLat); }); // PCの右クリック用

    loadMemosToMap(); // 初期ロード
});

// 🔍 住所検索
const searchInput = document.getElementById('addressSearchInput');
const execSearch = async () => {
    const q = searchInput.value.trim(); if (!q) return;
    try {
        const res = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${MAPTILER_KEY}&bbox=139.6,35.5,140.0,35.9`);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            map.flyTo({ center: data.features[0].center, zoom: 16 });
            searchInput.blur();
        } else alert("見つかりませんでした");
    } catch (e) {}
};
searchInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') execSearch(); });

// 📍 現在地取得 (非追尾・青いパルスドット)
document.getElementById('geoBackBtn').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(pos => {
        const coords = [pos.coords.longitude, pos.coords.latitude];
        map.flyTo({ center: coords, zoom: 16 });
        if (currentLocationMarker) currentLocationMarker.remove();
        const el = document.createElement('div'); el.className = 'current-location-dot';
        currentLocationMarker = new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map);
    });
});

// 📱 ボトムナビゲーション
const tabs = { 'tabMap': 'mapPage', 'tabBbs': 'bbsPage', 'tabProfile': 'profilePage' };
Object.keys(tabs).forEach(tabId => {
    document.getElementById(tabId).addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
        document.querySelectorAll('.page-section').forEach(p => p.style.display = 'none');
        document.getElementById(tabs[tabId]).style.display = 'block';
        if(tabId === 'tabMap') map.resize();
        if(tabId === 'tabBbs' && lastBbsDoc === null) loadBbsTimeline(false);
    });
});

// ==========================================
// ⚙️ プロフィール設定
// ==========================================
async function loadProfile() {
    try {
        const snap = await getDoc(doc(db, "profiles", currentUserId));
        if (snap.exists()) {
            const pData = snap.data();
            myProfileName = pData.displayName || "名無し配達員";
            document.getElementById('readName').textContent = myProfileName;
            document.getElementById('profileName').value = myProfileName !== "名無し配達員" ? myProfileName : "";
            
            document.getElementById('readArea').textContent = pData.mainArea || "未設定"; document.getElementById('readTime').textContent = pData.mainTime || "未設定";
            document.getElementById('readTotalLikes').textContent = pData.totalLikes || 0;
            
            const tagsContainer = document.getElementById('readTags'); tagsContainer.innerHTML = ""; 
            const allTags = [...(pData.vehicles || []), ...(pData.services || [])];
            if (allTags.length === 0) tagsContainer.innerHTML = "<span style='font-size:0.85em; color:#71767B;'>未設定</span>"; 
            else allTags.forEach(tag => { const span = document.createElement('span'); span.className = 'tag'; span.textContent = tag; tagsContainer.appendChild(span); });
            
            document.getElementById('profileArea').value = pData.mainArea || ""; document.getElementById('profileTime').value = pData.mainTime || "";
            document.querySelectorAll('input[name="vehicleTag"]').forEach(cb => cb.checked = pData.vehicles?.includes(cb.value)); document.querySelectorAll('input[name="serviceTag"]').forEach(cb => cb.checked = pData.services?.includes(cb.value));
        }
    } catch (e) {}
}
document.getElementById('editProfileBtn').addEventListener('click', () => { document.getElementById('profileReadMode').style.display = 'none'; document.getElementById('profileEditMode').style.display = 'block'; });
document.getElementById('cancelEditBtn').addEventListener('click', () => { document.getElementById('profileEditMode').style.display = 'none'; document.getElementById('profileReadMode').style.display = 'block'; });
document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const name = document.getElementById('profileName').value.trim() || "名無し配達員";
    const area = document.getElementById('profileArea').value.trim(); const time = document.getElementById('profileTime').value.trim();
    const vehicles = Array.from(document.querySelectorAll('input[name="vehicleTag"]:checked')).map(el => el.value); const services = Array.from(document.querySelectorAll('input[name="serviceTag"]:checked')).map(el => el.value);
    try { 
        await setDoc(doc(db, "profiles", currentUserId), { displayName: name, mainArea: area, mainTime: time, vehicles: vehicles, services: services, updatedAt: new Date() }, { merge: true }); 
        await loadProfile(); document.getElementById('profileEditMode').style.display = 'none'; document.getElementById('profileReadMode').style.display = 'block'; 
    } catch (error) {}
});
document.getElementById('submitOpinionBtn').addEventListener('click', async () => { 
    const text = document.getElementById('opinionInput').value.trim(); if (!text) return; 
    try { await addDoc(collection(db, "opinions"), { text: text, senderId: currentUserId, createdAt: new Date() }); alert('送信完了！'); document.getElementById('opinionInput').value = ""; } catch (e) {} 
});

// ==========================================
// 📝 攻略メモ (ボトムシート＆フィルター)
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

// フィルターボトムシートの初期化・制御
const filterCats = ['🏢 建物・入口', '🅿️ 駐輪スポット', '⚠️ 注意・取締り', '🚻 トイレ・公園', '💡 その他'];
const filterContainer = document.getElementById('filterCategoryContainer');
filterCats.forEach(cat => {
    const emoji = cat.substring(0, 2);
    filterContainer.innerHTML += `<label class="cat-chip"><input type="checkbox" value="${cat}" checked><span>${emoji} ${cat.substring(3)}</span></label>`;
});
document.getElementById('btnFilterMemo').addEventListener('click', () => {
    document.getElementById('memoBottomSheet').classList.remove('show');
    document.getElementById('memoActionPanel').classList.remove('show');
    document.getElementById('filterBottomSheet').classList.add('show');
});
document.getElementById('btnCloseFilter').addEventListener('click', () => {
    document.getElementById('filterBottomSheet').classList.remove('show');
    filterState.showMineOnly = document.getElementById('chkShowMineOnly').checked;
    filterState.categories = Array.from(filterContainer.querySelectorAll('input:checked')).map(cb => cb.value);
    applyFilters();
});

// 長押しでメモ投稿シートを開く
function openMemoAddSheet(lngLat) {
    targetLngLat = lngLat; // 座標を記憶
    document.getElementById('memoBottomSheet').classList.remove('show');
    document.getElementById('filterBottomSheet').classList.remove('show');
    document.getElementById('memoActionPanel').classList.add('show');
}
const closeMemoForm = () => { 
    document.getElementById('memoActionPanel').classList.remove('show'); 
    document.getElementById('btnRemoveImage').click(); document.getElementById('memoTextInput').value = ""; 
};
document.getElementById('btnCancelForm').addEventListener('click', closeMemoForm);

// 画像処理
async function handleMemoImage(file, btnTextId, defaultText) {
    if (!file) return; document.getElementById(btnTextId).textContent = "⏳ 圧縮中"; selectedImageDataUrl = await compressImage(file);
    document.getElementById('memoImagePreview').src = selectedImageDataUrl; document.getElementById('memoImagePreviewContainer').style.display = 'block'; document.getElementById('memoCameraBtnText').parentNode.style.display = 'none'; document.getElementById('memoImageBtnText').parentNode.style.display = 'none'; document.getElementById(btnTextId).textContent = defaultText;
}
document.getElementById('memoCameraInput').addEventListener('change', (e) => handleMemoImage(e.target.files[0], 'memoCameraBtnText', '📷 撮影')); 
document.getElementById('memoImageInput').addEventListener('change', (e) => handleMemoImage(e.target.files[0], 'memoImageBtnText', '📁 画像'));
document.getElementById('btnRemoveImage').addEventListener('click', () => { selectedImageDataUrl = null; document.getElementById('memoImageInput').value = ""; document.getElementById('memoCameraInput').value = ""; document.getElementById('memoImagePreviewContainer').style.display = 'none'; document.getElementById('memoCameraBtnText').parentNode.style.display = 'block'; document.getElementById('memoImageBtnText').parentNode.style.display = 'block'; });

// メモ保存
document.getElementById('btnSaveMemo').addEventListener('click', async () => {
    const text = document.getElementById('memoTextInput').value.trim(); if (!text && !selectedImageDataUrl) { alert("入力必須です"); return; }
    const catInput = document.querySelector('input[name="memoCatInput"]:checked');
    const category = catInput ? catInput.value : '💡 その他';
    const isShowName = document.getElementById('chkShowName').checked;
    const finalSenderName = isShowName ? myProfileName : "匿名ドライバー";

    const saveBtn = document.getElementById('btnSaveMemo'); saveBtn.disabled = true; saveBtn.textContent = "⏳ 送信中";
    try {
        let finalUrl = null; if (selectedImageDataUrl) { const storageRef = ref(storage, `memos/${Date.now()}_${currentUserId}.jpg`); await uploadString(storageRef, selectedImageDataUrl, 'data_url'); finalUrl = await getDownloadURL(storageRef); }
        await addDoc(collection(db, "memos"), { lat: targetLngLat.lat, lng: targetLngLat.lng, category: category, text: text, imageUrl: finalUrl, senderId: currentUserId, senderName: finalSenderName, likesCount: 0, createdAt: Date.now() });
        closeMemoForm(); await loadMemosToMap();
    } catch (e) { alert("エラーが発生しました"); } finally { saveBtn.disabled = false; saveBtn.textContent = "投稿する"; }
});

// DBから取得し、フィルターをかけてGeoJSON更新
async function loadMemosToMap() {
    const snap = await getDocs(collection(db, "memos"));
    allMemosData = [];
    snap.forEach(docSnap => allMemosData.push({ id: docSnap.id, ...docSnap.data() }));
    applyFilters();
}
function applyFilters() {
    if (!map.getSource('memos')) return;
    const features = [];
    allMemosData.forEach(data => {
        // フィルター適用
        if (filterState.showMineOnly && data.senderId !== currentUserId) return;
        if (!filterState.categories.includes(data.category)) return;

        const emoji = data.category ? data.category.substring(0, 2) : "📝"; 
        features.push({
            type: 'Feature', geometry: { type: 'Point', coordinates: [data.lng, data.lat] },
            properties: { id: data.id, emoji: emoji, category: data.category, text: data.text || "", imageUrl: data.imageUrl || "", senderId: data.senderId, senderName: data.senderName || "匿名", likesCount: data.likesCount || 0, createdAt: data.createdAt || 0 }
        });
    });
    map.getSource('memos').setData({ type: 'FeatureCollection', features: features });
}

// 📖 メモ詳細ボトムシート
function openMemoBottomSheet(props) {
    currentOpenMemoId = props.id;
    document.getElementById('sheetCategory').textContent = props.category;
    document.getElementById('sheetText').textContent = props.text;
    
    const diffMin = Math.floor((Date.now() - props.createdAt) / 60000);
    document.getElementById('sheetTime').textContent = diffMin < 60 ? `${diffMin}分前` : `${Math.floor(diffMin/60)}時間前`;
    
    const imgContainer = document.getElementById('sheetImageContainer');
    if(props.imageUrl) { imgContainer.style.display = 'block'; document.getElementById('sheetImage').src = props.imageUrl; document.getElementById('sheetImage').onclick = () => openImageViewer(props.imageUrl); } 
    else { imgContainer.style.display = 'none'; }
    
    document.getElementById('sheetAuthorName').textContent = props.senderName;
    document.getElementById('sheetLikeCount').textContent = props.likesCount;
    document.getElementById('btnDeleteMemo').style.display = (props.senderId === currentUserId) ? 'block' : 'none';

    document.getElementById('sheetAuthorContainer').onclick = () => { if (props.senderName !== "匿名ドライバー") openProfileModal(props.senderId, props.senderName); };
    
    document.getElementById('memoActionPanel').classList.remove('show');
    document.getElementById('filterBottomSheet').classList.remove('show');
    document.getElementById('memoBottomSheet').classList.add('show');
}

// ❤️ いいね
document.getElementById('btnLikeMemo').addEventListener('click', async () => {
    if(!currentOpenMemoId) return;
    try {
        await updateDoc(doc(db, "memos", currentOpenMemoId), { likesCount: increment(1) });
        const memoSnap = await getDoc(doc(db, "memos", currentOpenMemoId));
        if(memoSnap.exists()) { const targetId = memoSnap.data().senderId; await setDoc(doc(db, "profiles", targetId), { totalLikes: increment(1) }, { merge: true }); }
        document.getElementById('sheetLikeCount').textContent = parseInt(document.getElementById('sheetLikeCount').textContent) + 1;
        loadMemosToMap();
    } catch(e) {}
});

// 🗑️ 削除
document.getElementById('btnDeleteMemo').addEventListener('click', async () => {
    if(!currentOpenMemoId || !confirm("削除しますか？")) return;
    await deleteDoc(doc(db, "memos", currentOpenMemoId));
    document.getElementById('memoBottomSheet').classList.remove('show');
    loadMemosToMap();
});

// 👤 プロフィールモーダル
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
// 🕊️ 匿名掲示板 (変更なし)
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