import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDocs, updateDoc, increment, getDoc, addDoc, deleteDoc, query, orderBy, limit, startAfter } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { getStorage, ref, uploadString, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}

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

let currentUserName = "";
let selectedImageDataUrl = null;
let bbsSelectedImageDataUrl = null;
let lastBbsDoc = null; 

let driverMarkerObjects = [];
let memoMarkerObjects = [];

const map = L.map('map').setView([35.6635, 139.8731], 14);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { maxZoom: 20 }).addTo(map);

const mainClusterLayer = L.markerClusterGroup({
    maxClusterRadius: 40,
    disableClusteringAtZoom: 18,
    iconCreateFunction: function(cluster) {
        const markers = cluster.getAllChildMarkers();
        let dCount = 0, mCount = 0;
        markers.forEach(m => { if (m.markerType === 'driver') dCount++; if (m.markerType === 'memo') mCount++; });
        if (dCount > 0 && mCount === 0) return L.divIcon({ html: `<div>${dCount}</div>`, className: 'driver-cluster', iconSize: [40, 40] });
        else if (mCount > 0 && dCount === 0) return L.divIcon({ html: `<div>${mCount}</div>`, className: 'memo-cluster-fixed', iconSize: [40, 40] });
        else return L.divIcon({ html: `<div class="hybrid-driver">${dCount}</div><div class="hybrid-memo">${mCount}</div>`, className: 'hybrid-cluster', iconSize: [52, 32] });
    }
}).addTo(map);

// ----- ログイン・メニュー周辺 -----
document.querySelectorAll('input[name="posMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => { document.getElementById('manualCoordsArea').style.display = (e.target.value === 'manual') ? 'block' : 'none'; });
});
document.getElementById('menuBtn').addEventListener('click', async () => { document.getElementById('drawerMenu').classList.add('open'); if (currentUserName) await updateMyProfileInDrawer(); });
document.getElementById('closeMenuBtn').addEventListener('click', () => { document.getElementById('drawerMenu').classList.remove('open'); });

document.getElementById('actionBtn').addEventListener('click', async () => {
    const name = document.getElementById('nameInput').value.trim(); const msg = document.getElementById('msgInput').value.trim(); 
    const mode = document.querySelector('input[name="posMode"]:checked').value;
    if (!name) { alert('お名前を入力してください'); return; }
    currentUserName = name; 
    if (mode === 'auto') {
        document.getElementById('statusMessage').textContent = "GPS補足中...";
        navigator.geolocation.getCurrentPosition(async (pos) => { await sendCheckIn(name, msg, pos.coords.latitude, pos.coords.longitude, new Date()); }, () => alert('GPSエラーです。'));
    } else {
        const lat = parseFloat(document.getElementById('latInput').value); const lng = parseFloat(document.getElementById('lngInput').value); const timeInput = document.getElementById('timeInput').value;
        if (isNaN(lat) || isNaN(lng)) return;
        let t = new Date(); if (timeInput) { const [h, m] = timeInput.split(':'); t.setHours(h, m, 0, 0); }
        await sendCheckIn(name, msg, lat, lng, t);
    }
});
async function sendCheckIn(name, msg, lat, lng, updateTime) {
    try {
        await setDoc(doc(db, "locations", name), { displayName: name, statusMessage: msg, latitude: lat, longitude: lng, updatedAt: updateTime, checkInCount: increment(1) }, { merge: true });
        document.getElementById('statusMessage').textContent = ""; document.getElementById('loginPage').style.display = 'none'; document.getElementById('mapPage').style.display = 'block';
        document.getElementById('userGreeting').textContent = `${name} さん`; map.invalidateSize(); await loadMarkers(lat, lng); await loadMemos();
    } catch (e) { console.error(e); }
}

// ----- 地図ピン処理周辺 -----
document.getElementById('btnFilterMenu').addEventListener('click', () => { const menu = document.getElementById('filterMenu'); menu.style.display = menu.style.display === 'none' ? 'flex' : 'none'; });
document.getElementById('chkFilterDrivers').addEventListener('change', () => { const center = map.getCenter(); loadMarkers(center.lat, center.lng); });
document.getElementById('chkFilterAllMemos').addEventListener('change', loadMemos); document.getElementById('chkFilterMyMemos').addEventListener('change', loadMemos);

async function loadMarkers(myLat, myLng) {
    mainClusterLayer.removeLayers(driverMarkerObjects); driverMarkerObjects = [];
    if (!document.getElementById('chkFilterDrivers').checked) return;
    const snapshot = await getDocs(collection(db, "locations")); const now = new Date(); const twelveHoursAgo = new Date(now.getTime() - (12 * 60 * 60 * 1000)); 
    snapshot.forEach((doc) => {
        const data = doc.data(); if (!data.updatedAt) return; const pinTime = data.updatedAt.toDate(); if (pinTime < twelveHoursAgo) return; 
        const diffMins = Math.floor((now - pinTime) / 1000 / 60); let aura = diffMins < 30 ? "aura-green" : (diffMins < 60 ? "aura-yellow" : "aura-red");
        const icon = L.divIcon({ className: `ubag-pin`, html: `<div class="status-badge ${aura}"></div>`, iconSize: [50, 50], iconAnchor: [25, 50], popupAnchor: [0, -45] });
        const count = data.checkInCount || 0; let badge = count >= 30 ? "👑レジェンド" : (count >= 15 ? "🏅ベテラン" : (count >= 5 ? "🚴中堅" : "🔰新米"));
        const timeStr = `${String(pinTime.getHours()).padStart(2,'0')}:${String(pinTime.getMinutes()).padStart(2,'0')}`;
        const marker = L.marker([data.latitude + (Math.random()-0.5)*0.0003, data.longitude + (Math.random()-0.5)*0.0003], { icon: icon });
        marker.markerType = 'driver';
        marker.bindPopup(`<div style="min-width:150px; color:#000;"><b>${data.displayName}</b> <span style="color:#06C167; font-weight:bold;">[${badge}]</span><br><span style="color:#545454; font-size:0.8em;">更新: ${timeStr} | 👍応援: <b>${data.likesCount || 0}</b>回</span>${data.statusMessage ? `<p style="margin:6px 0; padding:8px; background:#F6F6F6; border-radius:6px;">「${data.statusMessage}」</p>` : ""}<button onclick="sendLike('${data.displayName}')" class="popup-btn">👍 応援を送る</button><button onclick="window.openProfileModal('${data.displayName}', '${badge}')" class="popup-btn-outline">👤 プロフィールを見る</button></div>`);
        driverMarkerObjects.push(marker);
    });
    mainClusterLayer.addLayers(driverMarkerObjects); if(myLat && myLng) map.setView([myLat, myLng], 14);
}
window.sendLike = async (targetName) => { try { await updateDoc(doc(db, "locations", targetName), { likesCount: increment(1) }); alert(`${targetName} さんに応援を送信しました！👍`); if (targetName === currentUserName) await updateMyProfileInDrawer(); const center = map.getCenter(); loadMarkers(center.lat, center.lng); } catch (error) { console.error(error); } };

// ----- プロフィール管理周辺 -----
async function updateMyProfileInDrawer() {
    try {
        const docSnap = await getDoc(doc(db, "locations", currentUserName));
        if (docSnap.exists()) {
            const data = docSnap.data(); const count = data.checkInCount || 0; let badge = count >= 30 ? "👑レジェンド" : (count >= 15 ? "🏅ベテラン" : (count >= 5 ? "🚴中堅" : "🔰新米"));
            document.getElementById('myProfileName').textContent = data.displayName; document.getElementById('myProfileMsg').textContent = data.statusMessage ? `「${data.statusMessage}」` : "（未設定）"; document.getElementById('myProfileCount').textContent = count; document.getElementById('myProfileBadge').textContent = badge; document.getElementById('myProfileLikes').textContent = data.likesCount || 0;
        }
        const profileSnap = await getDoc(doc(db, "profiles", currentUserName));
        if (profileSnap.exists()) {
            const pData = profileSnap.data(); document.getElementById('readArea').textContent = pData.mainArea || "未設定"; document.getElementById('readTime').textContent = pData.mainTime || "未設定";
            const tagsContainer = document.getElementById('readTags'); tagsContainer.innerHTML = ""; const allTags = [...(pData.vehicles || []), ...(pData.services || [])];
            if (allTags.length === 0) { tagsContainer.innerHTML = "<span style='font-size:0.85em; color:#767676;'>未設定</span>"; } else { allTags.forEach(tagText => { const span = document.createElement('span'); span.className = 'tag'; span.textContent = tagText; tagsContainer.appendChild(span); }); }
            document.getElementById('profileArea').value = pData.mainArea || ""; document.getElementById('profileTime').value = pData.mainTime || "";
            document.querySelectorAll('input[name="vehicleTag"]').forEach(cb => { cb.checked = pData.vehicles ? pData.vehicles.includes(cb.value) : false; }); document.querySelectorAll('input[name="serviceTag"]').forEach(cb => { cb.checked = pData.services ? pData.services.includes(cb.value) : false; });
        }
    } catch (error) { console.error(error); }
}
document.getElementById('editProfileBtn').addEventListener('click', () => { document.getElementById('profileReadMode').style.display = 'none'; document.getElementById('profileEditMode').style.display = 'block'; });
document.getElementById('cancelEditBtn').addEventListener('click', () => { document.getElementById('profileEditMode').style.display = 'none'; document.getElementById('profileReadMode').style.display = 'block'; });
document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    if (!currentUserName) return;
    const area = document.getElementById('profileArea').value.trim(); const time = document.getElementById('profileTime').value.trim();
    const vehicles = Array.from(document.querySelectorAll('input[name="vehicleTag"]:checked')).map(el => el.value); const services = Array.from(document.querySelectorAll('input[name="serviceTag"]:checked')).map(el => el.value);
    try { await setDoc(doc(db, "profiles", currentUserName), { mainArea: area, mainTime: time, vehicles: vehicles, services: services, updatedAt: new Date() }, { merge: true }); await updateMyProfileInDrawer(); document.getElementById('profileEditMode').style.display = 'none'; document.getElementById('profileReadMode').style.display = 'block'; alert("プロフィールを保存しました！"); } catch (error) { console.error(error); }
});
window.openProfileModal = async (targetName, badge) => {
    document.getElementById('modalName').textContent = targetName; document.getElementById('modalBadge').textContent = badge; document.getElementById('modalLikesCount').textContent = "-";
    document.getElementById('modalArea').textContent = "読み込み中..."; document.getElementById('modalTime').textContent = "読み込み中...";
    const tagsContainer = document.getElementById('modalTags'); tagsContainer.innerHTML = ""; document.getElementById('modalOverlay').style.display = 'block'; document.getElementById('profileModal').style.display = 'block';
    try {
        const locSnap = await getDoc(doc(db, "locations", targetName)); if (locSnap.exists()) document.getElementById('modalLikesCount').textContent = locSnap.data().likesCount || 0;
        const docSnap = await getDoc(doc(db, "profiles", targetName));
        if (docSnap.exists()) {
            const data = docSnap.data(); document.getElementById('modalArea').textContent = data.mainArea || "未設定"; document.getElementById('modalTime').textContent = data.mainTime || "未設定"; const allTags = [...(data.vehicles || []), ...(data.services || [])];
            if (allTags.length === 0) { tagsContainer.innerHTML = "<span style='font-size:0.85em; color:#767676;'>未設定</span>"; } else { allTags.forEach(tagText => { const span = document.createElement('span'); span.className = 'tag'; span.textContent = tagText; tagsContainer.appendChild(span); }); }
        } else { document.getElementById('modalArea').textContent = "未設定"; document.getElementById('modalTime').textContent = "未設定"; tagsContainer.innerHTML = "<span style='font-size:0.85em; color:#767676;'>未設定</span>"; }
    } catch (error) { console.error(error); }
    const likeBtn = document.getElementById('modalLikeBtn'); likeBtn.onclick = () => { window.sendLike(targetName); document.getElementById('modalOverlay').style.display = 'none'; document.getElementById('profileModal').style.display = 'none'; };
};
document.getElementById('closeModalBtn').addEventListener('click', () => { document.getElementById('modalOverlay').style.display = 'none'; document.getElementById('profileModal').style.display = 'none'; });
document.getElementById('modalOverlay').addEventListener('click', () => { document.getElementById('modalOverlay').style.display = 'none'; document.getElementById('profileModal').style.display = 'none'; });

// ----- 共通画像圧縮 -----
function compressImage(file, maxWidth = 800) {
    return new Promise((resolve) => {
        const reader = new FileReader(); reader.onload = (e) => {
            const img = new Image(); img.onload = () => {
                const canvas = document.createElement('canvas'); let width = img.width; let height = img.height;
                if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
                canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height); resolve(canvas.toDataURL('image/jpeg', 0.7)); 
            }; img.src = e.target.result;
        }; reader.readAsDataURL(file);
    });
}

// ----- 地図側のメモ機能周辺 -----
async function handleImageSelection(file, btnTextId, defaultText) {
    if (!file) return; document.getElementById(btnTextId).textContent = "⏳ 圧縮中..."; selectedImageDataUrl = await compressImage(file);
    document.getElementById('memoImagePreview').src = selectedImageDataUrl; document.getElementById('memoImagePreviewContainer').style.display = 'block'; document.getElementById('imageUploadButtons').style.display = 'none'; document.getElementById(btnTextId).textContent = defaultText;
}
document.getElementById('memoCameraInput').addEventListener('change', (e) => handleImageSelection(e.target.files[0], 'memoCameraBtnText', '📷 その場で撮影')); document.getElementById('memoImageInput').addEventListener('change', (e) => handleImageSelection(e.target.files[0], 'memoImageBtnText', '📁 フォルダから'));
document.getElementById('btnRemoveImage').addEventListener('click', () => { selectedImageDataUrl = null; document.getElementById('memoImageInput').value = ""; document.getElementById('memoCameraInput').value = ""; document.getElementById('memoImagePreviewContainer').style.display = 'none'; document.getElementById('imageUploadButtons').style.display = 'flex'; });
document.getElementById('btnSaveMemo').addEventListener('click', async () => {
    const text = document.getElementById('memoTextInput').value.trim(); if (!text && !selectedImageDataUrl) { alert("メモか写真のどちらかは必要です！"); return; }
    const center = map.getCenter(); const category = document.querySelector('input[name="memoCat"]:checked').value; const saveBtn = document.getElementById('btnSaveMemo'); saveBtn.disabled = true; saveBtn.textContent = "⏳ 送信中...";
    try {
        let finalImageUrl = null; if (selectedImageDataUrl) { const fileName = `memos/${Date.now()}_${currentUserName}.jpg`; const storageRef = ref(storage, fileName); await uploadString(storageRef, selectedImageDataUrl, 'data_url'); finalImageUrl = await getDownloadURL(storageRef); }
        await addDoc(collection(db, "memos"), { lat: center.lat, lng: center.lng, category: category, text: text, imageUrl: finalImageUrl, sender: currentUserName, createdAt: new Date() });
        alert("攻略メモを登録しました！"); closeMemoMode(); await loadMemos();
    } catch (e) { alert("保存に失敗しました。"); } finally { saveBtn.disabled = false; saveBtn.textContent = "💾 メモを保存"; }
});
async function loadMemos() {
    mainClusterLayer.removeLayers(memoMarkerObjects); memoMarkerObjects = [];
    const showAll = document.getElementById('chkFilterAllMemos').checked; const showMine = document.getElementById('chkFilterMyMemos').checked; if (!showAll && !showMine) return;
    const snapshot = await getDocs(collection(db, "memos"));
    snapshot.forEach((docSnap) => {
        const data = docSnap.data(); const isMine = (data.sender === currentUserName); if (isMine && !showMine) return; if (!isMine && !showAll) return;
        const emoji = data.category ? data.category.substring(0, 2) : "📝"; const icon = L.divIcon({ className: 'memo-custom-pin', html: `<div>${emoji}</div>`, iconSize:[36,36], iconAnchor:[18,18], popupAnchor:[0,-18] });
        const marker = L.marker([data.lat, data.lng], { icon: icon }); marker.markerType = 'memo';
        let imgHtml = ""; if (data.imageUrl) { imgHtml = `<img src="${data.imageUrl}" onclick="openImageViewer('${data.imageUrl}')" style="width:100%; height:120px; object-fit:cover; border-radius:6px; margin-top:8px; cursor:pointer; border:1px solid #E2E2E2;">`; }
        let delBtn = isMine ? `<button onclick="deleteMemo('${docSnap.id}')" style="margin-top:8px; width:100%; padding:6px; background:none; border:1px solid #DC3545; color:#DC3545; border-radius:4px; cursor:pointer;">🗑️ 削除</button>` : "";
        marker.bindPopup(`<div style="min-width:160px; color:#000;"><b style="color:#333;">${data.category}</b><br><span style="font-size:0.75em; color:#767676;">投稿: ${data.sender}</span>${data.text ? `<p style="margin:6px 0 4px 0; font-size:0.95em; background:#FFF9E6; padding:8px; border-radius:6px;">${data.text}</p>` : ""}${imgHtml}${delBtn}</div>`);
        memoMarkerObjects.push(marker);
    });
    mainClusterLayer.addLayers(memoMarkerObjects);
}
window.deleteMemo = async (id) => { if(!confirm("このメモを削除しますか？")) return; await deleteDoc(doc(db, "memos", id)); map.closePopup(); await loadMemos(); };


// ==========================================================================
// 🆕 🖤 Twitter（X）風 匿名タイムライン制御ロジック
// ==========================================================================

// ランダム絵文字アバターの設定（5パターン）
const avatarEmojis = ['🛵', '🚲', '🍔', '🐱', '🕶️'];
const avatarColors = ['#1d9bf0', '#00ba7c', '#f91880', '#ff7a00', '#7856ff'];

// 画面切り替え ＆ FAB（＋）ボタン操作
document.getElementById('goToBbsBtn').addEventListener('click', () => { document.getElementById('mapPage').style.display = 'none'; document.getElementById('bbsPage').style.display = 'flex'; loadBbsTimeline(false); });
document.getElementById('backToMapBtn').addEventListener('click', () => { document.getElementById('bbsPage').style.display = 'none'; document.getElementById('mapPage').style.display = 'block'; map.invalidateSize(); });
document.getElementById('fabPostBtn').addEventListener('click', () => { document.getElementById('bbsComposePage').style.display = 'flex'; });
document.getElementById('btnCancelBbs').addEventListener('click', () => { document.getElementById('bbsComposePage').style.display = 'none'; document.getElementById('btnRemoveBbsImage').click(); document.getElementById('bbsTextInput').value = ""; });

// 掲示板用の画像選択
async function handleBbsImageSelection(file) {
    if (!file) return; document.getElementById('bbsCompressStatus').textContent = "⏳ 圧縮中...";
    bbsSelectedImageDataUrl = await compressImage(file); document.getElementById('bbsImagePreview').src = bbsSelectedImageDataUrl;
    document.getElementById('bbsImagePreviewContainer').style.display = 'block'; document.getElementById('bbsCompressStatus').textContent = "📸 圧縮完了！";
}
document.getElementById('bbsCameraInput').addEventListener('change', (e) => handleBbsImageSelection(e.target.files[0]));
document.getElementById('bbsImageInput').addEventListener('change', (e) => handleBbsImageSelection(e.target.files[0]));
document.getElementById('btnRemoveBbsImage').addEventListener('click', () => { bbsSelectedImageDataUrl = null; document.getElementById('bbsCameraInput').value = ""; document.getElementById('bbsImageInput').value = ""; document.getElementById('bbsImagePreviewContainer').style.display = 'none'; document.getElementById('bbsCompressStatus').textContent = ""; });

// 投稿（ポストする）ロジック
document.getElementById('btnPostBbs').addEventListener('click', async () => {
    const text = document.getElementById('bbsTextInput').value.trim();
    if (!text && !bbsSelectedImageDataUrl) { alert("なにか入力するか写真を選んでください！"); return; }
    const postBtn = document.getElementById('btnPostBbs'); postBtn.disabled = true; postBtn.textContent = "送信中";

    try {
        let finalImageUrl = null; let finalImagePath = null;
        if (bbsSelectedImageDataUrl) {
            finalImagePath = `bbs_images/${Date.now()}_anonymous.jpg`; const storageRef = ref(storage, finalImagePath);
            await uploadString(storageRef, bbsSelectedImageDataUrl, 'data_url'); finalImageUrl = await getDownloadURL(storageRef);
        }

        // アバターを0〜4の中からランダム決定
        const randAvatarId = Math.floor(Math.random() * 5);

        // Firestoreへ書き込み（3種のリアクションカウンターも初期化）
        await addDoc(collection(db, "bbs"), {
            text: text, imageUrl: finalImageUrl, imagePath: finalImagePath, createdAt: new Date(),
            avatarId: randAvatarId,
            rxHandshake: 0, rxCoffee: 0, rxBulb: 0
        });

        document.getElementById('btnCancelBbs').click(); // フォームを閉じて初期化

        // 100件自動玉突き削除
        const qAll = query(collection(db, "bbs"), orderBy("createdAt", "desc"));
        const allSnap = await getDocs(qAll);
        if (allSnap.size > 100) {
            for (let i = 100; i < allSnap.size; i++) {
                const oldDoc = allSnap.docs[i]; const oldData = oldDoc.data();
                if (oldData.imagePath) { try { const oldStorageRef = ref(storage, oldData.imagePath); await deleteObject(oldStorageRef); } catch (err) {} }
                await deleteDoc(oldDoc.ref);
            }
        }
        await loadBbsTimeline(false);
    } catch (err) { console.error(err); alert("投稿に失敗しました。"); } 
    finally { postBtn.disabled = false; postBtn.textContent = "ポストする"; }
});

// タイムライン読み込み
async function loadBbsTimeline(isMore = false) {
    const bbsList = document.getElementById('bbsList'); const moreBtn = document.getElementById('btnLoadMoreBbs');
    if (!isMore) { bbsList.innerHTML = ""; lastBbsDoc = null; }
    let q;
    if (isMore && lastBbsDoc) q = query(collection(db, "bbs"), orderBy("createdAt", "desc"), startAfter(lastBbsDoc), limit(20));
    else q = query(collection(db, "bbs"), orderBy("createdAt", "desc"), limit(20));
    
    const snapshot = await getDocs(q);
    if (snapshot.empty) { if (!isMore) bbsList.innerHTML = "<p style='text-align:center; color:#71767B; padding:40px; font-size:0.95em;'>まだポストがありません。</p>"; moreBtn.style.display = "none"; return; }
    lastBbsDoc = snapshot.docs[snapshot.docs.length - 1];

    snapshot.forEach((docSnap) => {
        const id = docSnap.id; const data = docSnap.data();
        const card = document.createElement('div'); card.className = "bbs-card";
        
        let timeStr = "時間不明";
        if (data.createdAt) { const date = data.createdAt.toDate(); timeStr = `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`; }
        
        // ランダムアバターの割り当て
        const aId = data.avatarId !== undefined ? data.avatarId : 0;
        const emoji = avatarEmojis[aId]; const color = avatarColors[aId];
        const avatarHtml = `<div class="bbs-avatar" style="background-color: ${color};">${emoji}</div>`;
        const imgHtml = data.imageUrl ? `<img src="${data.imageUrl}" class="bbs-card-image" onclick="openImageViewer('${data.imageUrl}')">` : "";

        card.innerHTML = `
            <div class="bbs-avatar-column">${avatarHtml}</div>
            <div class="bbs-card-content">
                <div class="bbs-card-meta"><span class="bbs-user-name">匿名ドライバー</span><span class="bbs-time-stamp">@kasai_driver · ${timeStr}</span></div>
                <div class="bbs-card-text">${data.text || ""}</div>
                ${imgHtml}
                <div class="bbs-reactions-bar">
                    <div class="bbs-reaction" id="rx-handshake-${id}"><span class="rx-icon">🤝</span> <span class="rx-count">${data.rxHandshake || 0}</span></div>
                    <div class="bbs-reaction" id="rx-coffee-${id}"><span class="rx-icon">☕</span> <span class="rx-count">${data.rxCoffee || 0}</span></div>
                    <div class="bbs-reaction" id="rx-bulb-${id}"><span class="rx-icon">💡</span> <span class="rx-count">${data.rxBulb || 0}</span></div>
                </div>
            </div>
        `;
        bbsList.appendChild(card);

        // 3種のリアクション押下イベント
        const attachReaction = (type, key) => {
            const el = card.querySelector(`#rx-${type}-${id}`);
            el.addEventListener('click', async () => {
                if (el.classList.contains('acted')) return;
                el.classList.add('acted');
                const countEl = el.querySelector('.rx-count');
                countEl.textContent = parseInt(countEl.textContent) + 1;
                try { await updateDoc(doc(db, "bbs", id), { [key]: increment(1) }); } catch (err) {}
            });
        };
        attachReaction('handshake', 'rxHandshake');
        attachReaction('coffee', 'rxCoffee');
        attachReaction('bulb', 'rxBulb');
    });

    if (snapshot.size === 20) moreBtn.style.display = "block"; else moreBtn.style.display = "none";
}
document.getElementById('btnLoadMoreBbs').addEventListener('click', () => loadBbsTimeline(true));

// 共通機能
window.openImageViewer = (url) => { document.getElementById('fullSizeImage').src = url; document.getElementById('imageViewerOverlay').style.display = 'block'; document.getElementById('imageViewerModal').style.display = 'block'; };
const closeViewer = () => { document.getElementById('imageViewerOverlay').style.display = 'none'; document.getElementById('imageViewerModal').style.display = 'none'; };
document.getElementById('closeImageViewerBtn').addEventListener('click', closeViewer); document.getElementById('imageViewerOverlay').addEventListener('click', closeViewer);
document.getElementById('geoBackBtn').addEventListener('click', () => { navigator.geolocation.getCurrentPosition(pos => map.setView([pos.coords.latitude, pos.coords.longitude], 16)); });
document.getElementById('addMemoModeBtn').addEventListener('click', () => { document.getElementById('mapCenterTarget').style.display = 'block'; document.getElementById('mapControlsContainer').style.display = 'none'; document.getElementById('memoActionPanel').style.display = 'block'; document.getElementById('memoPhaseLoc').style.display = 'block'; document.getElementById('memoPhaseForm').style.display = 'none'; });
document.getElementById('btnConfirmLoc').addEventListener('click', () => { document.getElementById('memoPhaseLoc').style.display = 'none'; document.getElementById('memoPhaseForm').style.display = 'block'; });
const closeMemoMode = () => { document.getElementById('mapCenterTarget').style.display = 'none'; document.getElementById('memoActionPanel').style.display = 'none'; document.getElementById('mapControlsContainer').style.display = 'flex'; document.getElementById('btnRemoveImage').click(); document.getElementById('memoTextInput').value = ""; };
document.getElementById('btnCancelMemo').addEventListener('click', closeMemoMode); document.getElementById('btnCancelForm').addEventListener('click', closeMemoMode);
document.getElementById('submitOpinionBtn').addEventListener('click', async () => { const opinionText = document.getElementById('opinionInput').value.trim(); if (!opinionText) { alert('ご意見を入力してください。'); return; } try { await addDoc(collection(db, "opinions"), { text: opinionText, sender: currentUserName || "匿名ユーザー", createdAt: new Date() }); alert('フィードバックを送信しました。ご協力ありがとうございます！'); document.getElementById('opinionInput').value = ""; } catch (error) {} });