import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDocs, updateDoc, increment, getDoc, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
// 📷 Storageの機能を追加インポート
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";

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
const storage = getStorage(app); // Storageを起動

let currentUserName = "";
let isMemoMode = false;
let selectedImageDataUrl = null; // 圧縮済みの写真データ

const map = L.map('map').setView([35.6635, 139.8731], 14);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { maxZoom: 20 }).addTo(map);

// 🟢 レイヤー（階層）を綺麗に分割
const driverLayer = L.layerGroup().addTo(map); // 配達員ピン用
const memoClusterLayer = L.markerClusterGroup({ 
    maxClusterRadius: 40, // 近づくとまとまる距離
    disableClusteringAtZoom: 18 // 最大ズーム時は必ずバラける
}).addTo(map);

// ----- ログイン＆チェックイン処理 -----
document.querySelectorAll('input[name="posMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        document.getElementById('manualCoordsArea').style.display = (e.target.value === 'manual') ? 'block' : 'none';
    });
});

document.getElementById('actionBtn').addEventListener('click', async () => {
    const name = document.getElementById('nameInput').value.trim();
    const msg = document.getElementById('msgInput').value.trim(); 
    const mode = document.querySelector('input[name="posMode"]:checked').value;
    if (!name) { alert('お名前を入力してください'); return; }
    currentUserName = name; 

    if (mode === 'auto') {
        document.getElementById('statusMessage').textContent = "GPS補足中...";
        navigator.geolocation.getCurrentPosition(async (pos) => {
            await sendCheckIn(name, msg, pos.coords.latitude, pos.coords.longitude, new Date());
        }, () => alert('GPSエラーです。'));
    } else {
        const lat = parseFloat(document.getElementById('latInput').value);
        const lng = parseFloat(document.getElementById('lngInput').value);
        const timeInput = document.getElementById('timeInput').value;
        if (isNaN(lat) || isNaN(lng)) return;
        let t = new Date();
        if (timeInput) { const [h, m] = timeInput.split(':'); t.setHours(h, m, 0, 0); }
        await sendCheckIn(name, msg, lat, lng, t);
    }
});

async function sendCheckIn(name, msg, lat, lng, updateTime) {
    await setDoc(doc(db, "locations", name), {
        displayName: name, statusMessage: msg, latitude: lat, longitude: lng,
        updatedAt: updateTime, checkInCount: increment(1)
    }, { merge: true });
    
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mapPage').style.display = 'block';
    document.getElementById('userGreeting').textContent = `${name} さん`;
    map.invalidateSize(); 
    await loadMarkers(lat, lng);
    await loadMemos();
}

// ----- 表示フィルターの連動 -----
document.getElementById('btnFilterMenu').addEventListener('click', () => {
    const menu = document.getElementById('filterMenu');
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
});
document.getElementById('chkFilterDrivers').addEventListener('change', () => {
    const center = map.getCenter();
    loadMarkers(center.lat, center.lng);
});
document.getElementById('chkFilterAllMemos').addEventListener('change', loadMemos);
document.getElementById('chkFilterMyMemos').addEventListener('change', loadMemos);


// ----- 配達員の読み込み -----
async function loadMarkers(myLat, myLng) {
    driverLayer.clearLayers();
    if (!document.getElementById('chkFilterDrivers').checked) return; // フィルターオフなら処理しない

    const snapshot = await getDocs(collection(db, "locations"));
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - (12 * 60 * 60 * 1000)); 

    snapshot.forEach((doc) => {
        const data = doc.data();
        if (!data.updatedAt) return;
        const pinTime = data.updatedAt.toDate();
        if (pinTime < twelveHoursAgo) return; 

        const diffMins = Math.floor((now - pinTime) / 1000 / 60); 
        let aura = diffMins < 30 ? "aura-green" : (diffMins < 60 ? "aura-yellow" : "aura-red");
        
        const icon = L.divIcon({
            className: `ubag-pin`, html: `<div class="status-badge ${aura}"></div>`, 
            iconSize: [50, 50], iconAnchor: [25, 50], popupAnchor: [0, -45]
        });

        const count = data.checkInCount || 0;
        let badge = count >= 30 ? "👑レジェンド" : (count >= 15 ? "🏅ベテラン" : (count >= 5 ? "🚴中堅" : "🔰新米"));
        const timeStr = `${String(pinTime.getHours()).padStart(2,'0')}:${String(pinTime.getMinutes()).padStart(2,'0')}`;

        const marker = L.marker([data.latitude + (Math.random()-0.5)*0.0003, data.longitude + (Math.random()-0.5)*0.0003], { icon: icon });
        
        marker.bindPopup(`
            <div style="min-width:150px; color:#000;">
                <b>${data.displayName}</b> <span style="color:#06C167; font-weight:bold;">[${badge}]</span><br>
                <span style="color:#545454; font-size:0.8em;">更新: ${timeStr} | 👍応援: <b>${data.likesCount || 0}</b></span>
                ${data.statusMessage ? `<p style="margin:6px 0; padding:8px; background:#F6F6F6; border-radius:6px;">「${data.statusMessage}」</p>` : ""}
                <button onclick="sendLike('${data.displayName}')" class="popup-btn">👍 応援を送る</button>
                <button onclick="window.openProfileModal('${data.displayName}', '${badge}')" class="popup-btn-outline">👤 プロフを見る</button>
            </div>
        `);
        driverLayer.addLayer(marker);
    });
    if(myLat && myLng) map.setView([myLat, myLng], 14);
}

// ----- 📷 スマホ側での画像超圧縮ロジック -----
function compressImage(file, maxWidth = 800) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                // 容量を激減させる魔法の処理（70%の画質のJPEGに変換）
                resolve(canvas.toDataURL('image/jpeg', 0.7)); 
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// 写真選択時のプレビュー表示
document.getElementById('memoImageInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('memoImageBtnText').textContent = "⏳ 圧縮中...";
    selectedImageDataUrl = await compressImage(file);
    
    document.getElementById('memoImagePreview').src = selectedImageDataUrl;
    document.getElementById('memoImagePreviewContainer').style.display = 'block';
    document.querySelector('.image-upload-btn').style.display = 'none';
});

// 写真の取り消し
document.getElementById('btnRemoveImage').addEventListener('click', () => {
    selectedImageDataUrl = null;
    document.getElementById('memoImageInput').value = "";
    document.getElementById('memoImagePreviewContainer').style.display = 'none';
    document.querySelector('.image-upload-btn').style.display = 'block';
    document.getElementById('memoImageBtnText').textContent = "📸 写真を選ぶ";
});


// ----- 📝 攻略メモの保存と読み込み -----
document.getElementById('btnSaveMemo').addEventListener('click', async () => {
    const text = document.getElementById('memoTextInput').value.trim();
    if (!text && !selectedImageDataUrl) { alert("メモか写真のどちらかは必要です！"); return; }

    const center = map.getCenter();
    const category = document.querySelector('input[name="memoCat"]:checked').value;
    const saveBtn = document.getElementById('btnSaveMemo');
    
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳ 送信中...";

    try {
        let finalImageUrl = null;
        // 写真があればStorageへ送信
        if (selectedImageDataUrl) {
            const fileName = `memos/${Date.now()}_${currentUserName}.jpg`;
            const storageRef = ref(storage, fileName);
            await uploadString(storageRef, selectedImageDataUrl, 'data_url');
            finalImageUrl = await getDownloadURL(storageRef);
        }

        // Firestoreへ文字データと写真URLを保存
        await addDoc(collection(db, "memos"), {
            lat: center.lat, lng: center.lng,
            category: category, text: text,
            imageUrl: finalImageUrl,
            sender: currentUserName, createdAt: new Date()
        });
        
        alert("攻略メモを登録しました！");
        document.getElementById('btnRemoveImage').click(); // 写真リセット
        closeMemoMode();
        await loadMemos();
    } catch (e) {
        console.error("保存エラー:", e);
        alert("保存に失敗しました。");
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 メモを保存";
    }
});

async function loadMemos() {
    memoClusterLayer.clearLayers();
    
    const showAll = document.getElementById('chkFilterAllMemos').checked;
    const showMine = document.getElementById('chkFilterMyMemos').checked;
    if (!showAll && !showMine) return; // 両方オフなら何も出さない

    const snapshot = await getDocs(collection(db, "memos"));
    
    snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const isMine = (data.sender === currentUserName);
        
        // フィルターによる弾き処理
        if (isMine && !showMine) return;
        if (!isMine && !showAll) return;

        const emoji = data.category ? data.category.substring(0, 2) : "📝";
        const icon = L.divIcon({ className: 'memo-custom-pin', html: `<div>${emoji}</div>`, iconSize:[36,36], iconAnchor:[18,18], popupAnchor:[0,-18] });
        const marker = L.marker([data.lat, data.lng], { icon: icon });

        // 🖼️ 画像がある場合はサムネイルHTMLを生成
        let imgHtml = "";
        if (data.imageUrl) {
            imgHtml = `<img src="${data.imageUrl}" onclick="openImageViewer('${data.imageUrl}')" style="width:100%; height:120px; object-fit:cover; border-radius:6px; margin-top:8px; cursor:pointer; border:1px solid #E2E2E2;">`;
        }

        let delBtn = isMine ? `<button onclick="deleteMemo('${docSnap.id}')" style="margin-top:8px; width:100%; padding:6px; background:none; border:1px solid #DC3545; color:#DC3545; border-radius:4px; cursor:pointer;">🗑️ 削除</button>` : "";

        marker.bindPopup(`
            <div style="min-width:160px; color:#000;">
                <b style="color:#333;">${data.category}</b><br>
                <span style="font-size:0.75em; color:#767676;">投稿: ${data.sender}</span>
                ${data.text ? `<p style="margin:6px 0 4px 0; font-size:0.95em; background:#FFF9E6; padding:8px; border-radius:6px;">${data.text}</p>` : ""}
                ${imgHtml}
                ${delBtn}
            </div>
        `);
        memoClusterLayer.addLayer(marker);
    });
}

// ----- その他・UI制御 -----
window.openImageViewer = (url) => {
    document.getElementById('fullSizeImage').src = url;
    document.getElementById('imageViewerOverlay').style.display = 'block';
    document.getElementById('imageViewerModal').style.display = 'block';
};
const closeViewer = () => {
    document.getElementById('imageViewerOverlay').style.display = 'none';
    document.getElementById('imageViewerModal').style.display = 'none';
};
document.getElementById('closeImageViewerBtn').addEventListener('click', closeViewer);
document.getElementById('imageViewerOverlay').addEventListener('click', closeViewer);

document.getElementById('geoBackBtn').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(pos => map.setView([pos.coords.latitude, pos.coords.longitude], 16));
});

document.getElementById('addMemoModeBtn').addEventListener('click', () => {
    document.getElementById('mapCenterTarget').style.display = 'block';
    document.getElementById('mapControlsContainer').style.display = 'none';
    document.getElementById('memoActionPanel').style.display = 'block';
    document.getElementById('memoPhaseLoc').style.display = 'block';
    document.getElementById('memoPhaseForm').style.display = 'none';
});

document.getElementById('btnConfirmLoc').addEventListener('click', () => {
    document.getElementById('memoPhaseLoc').style.display = 'none';
    document.getElementById('memoPhaseForm').style.display = 'block';
});

const closeMemoMode = () => {
    document.getElementById('mapCenterTarget').style.display = 'none';
    document.getElementById('memoActionPanel').style.display = 'none';
    document.getElementById('mapControlsContainer').style.display = 'flex';
};
document.getElementById('btnCancelMemo').addEventListener('click', closeMemoMode);
document.getElementById('btnCancelForm').addEventListener('click', closeMemoMode);

window.deleteMemo = async (id) => {
    if(!confirm("削除しますか？")) return;
    await deleteDoc(doc(db, "memos", id)); map.closePopup(); await loadMemos();
};
window.sendLike = async (name) => {
    await updateDoc(doc(db, "locations", name), { likesCount: increment(1) });
    alert(`${name} さんを応援しました！`);
};

// メニューやプロフィールの基本処理（省略せずそのまま）
document.getElementById('menuBtn').addEventListener('click', async () => {
    document.getElementById('drawerMenu').classList.add('open');
    if (currentUserName) {
        const docSnap = await getDoc(doc(db, "locations", currentUserName));
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('myProfileName').textContent = data.displayName;
            document.getElementById('myProfileMsg').textContent = data.statusMessage || "（未設定）";
            document.getElementById('myProfileCount').textContent = data.checkInCount || 0;
            document.getElementById('myProfileLikes').textContent = data.likesCount || 0;
        }
    }
});
document.getElementById('closeMenuBtn').addEventListener('click', () => document.getElementById('drawerMenu').classList.remove('open'));