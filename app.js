import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDocs, updateDoc, increment, getDoc, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// PWA用のService Workerを登録する
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker 登録成功:', reg.scope))
            .catch(err => console.log('Service Worker 登録失敗:', err));
    });
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

let currentUserName = "";
let isMemoMode = false;              // 照準位置合わせモードフラグ
let currentMemoFilter = "all";       // メモの切り替え状態 ("all" または "mine")
let memoMarkersLayer = L.layerGroup(); // メモピンを管理する専用レイヤー

const map = L.map('map').setView([35.6635, 139.8731], 14);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors, © CARTO',
    maxZoom: 20
}).addTo(map);

memoMarkersLayer.addTo(map); // メモレイヤーをマップに追加

// 座標・時間入力欄の開閉
document.querySelectorAll('input[name="posMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        document.getElementById('manualCoordsArea').style.display = (e.target.value === 'manual') ? 'block' : 'none';
    });
});

// ドロワーメニューの開閉
document.getElementById('menuBtn').addEventListener('click', async () => {
    document.getElementById('drawerMenu').classList.add('open');
    if (currentUserName) {
        await updateMyProfileInDrawer();
    }
});
document.getElementById('closeMenuBtn').addEventListener('click', () => {
    document.getElementById('drawerMenu').classList.remove('open');
});

// チェックイン処理
document.getElementById('actionBtn').addEventListener('click', async () => {
    const name = document.getElementById('nameInput').value.trim();
    const msg = document.getElementById('msgInput').value.trim(); 
    const mode = document.querySelector('input[name="posMode"]:checked').value;

    if (!name) {
        alert('お名前を入力してください');
        return;
    }
    currentUserName = name; 

    if (mode === 'auto') {
        document.getElementById('statusMessage').textContent = "GPS信号を補足中...";
        navigator.geolocation.getCurrentPosition(async (position) => {
            await sendCheckIn(name, msg, position.coords.latitude, position.coords.longitude, new Date());
        }, (error) => {
            alert('位置情報の取得に失敗しました。GPS設定を確認してください。');
            document.getElementById('statusMessage').textContent = "";
        });
    } else {
        const lat = parseFloat(document.getElementById('latInput').value);
        const lng = parseFloat(document.getElementById('lngInput').value);
        const timeInput = document.getElementById('timeInput').value;

        if (isNaN(lat) || isNaN(lng)) {
            alert('緯度と経度を正しい数値で入力してください。');
            return;
        }

        let checkInTime = new Date();
        if (timeInput) {
            const [hours, minutes] = timeInput.split(':');
            checkInTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
        }

        await sendCheckIn(name, msg, lat, lng, checkInTime);
    }
});

async function sendCheckIn(name, msg, lat, lng, updateTime) {
    try {
        const userDocRef = doc(db, "locations", name);
        await setDoc(userDocRef, {
            displayName: name,
            statusMessage: msg, 
            latitude: lat,
            longitude: lng,
            updatedAt: updateTime, 
            checkInCount: increment(1)
        }, { merge: true });

        document.getElementById('statusMessage').textContent = "";
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('mapPage').style.display = 'block';
        document.getElementById('userGreeting').textContent = `${name} さん`;
        
        map.invalidateSize(); 
        await loadMarkers(lat, lng);
        await loadMemos(); // ログイン時にメモも自動読み込み

    } catch (error) {
        console.error("エラー: ", error);
        alert('送信に失敗しました。');
    }
}

// 配達員マーカー読み込み ＆ 応援数の反映③
async function loadMarkers(myLat, myLng) {
    try {
        const querySnapshot = await getDocs(collection(db, "locations"));
        
        map.eachLayer((layer) => {
            if (layer instanceof L.Marker && !layer.isMemo) map.removeLayer(layer);
        });

        const now = new Date();
        const twelveHoursAgo = new Date(now.getTime() - (12 * 60 * 60 * 1000)); 

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (!data.updatedAt) return;
            
            const pinTime = data.updatedAt.toDate();
            if (pinTime < twelveHoursAgo) return; 

            const hours = String(pinTime.getHours()).padStart(2, '0');
            const mins = String(pinTime.getMinutes()).padStart(2, '0');
            const timeStr = `${hours}:${mins}`;

            const diffMins = Math.floor((now - pinTime) / 1000 / 60); 
            let auraClass = "aura-red"; 
            if (diffMins < 30) auraClass = "aura-green"; 
            else if (diffMins < 60) auraClass = "aura-yellow"; 

            const randomLatOffset = (Math.random() - 0.5) * 0.0003;
            const randomLngOffset = (Math.random() - 0.5) * 0.0003;
            const displayLat = data.latitude + randomLatOffset;
            const displayLng = data.longitude + randomLngOffset;

            const customIcon = L.divIcon({
                className: `ubag-pin`, 
                html: `<div class="status-badge ${auraClass}"></div>`, 
                iconSize: [50, 50],
                iconAnchor: [25, 50], 
                popupAnchor: [0, -45]
            });

            const count = data.checkInCount || 0;
            let badge = "🔰新米";
            if (count >= 30) badge = "👑レジェンド";
            else if (count >= 15) badge = "🏅ベテラン";
            else if (count >= 5) badge = "🚴中堅";

            const likes = data.likesCount || 0; // 💖 応援された数を取得

            const marker = L.marker([displayLat, displayLng], { icon: customIcon }).addTo(map);
            marker.isMemo = false;

            const popupContent = `
                <div style="font-family:sans-serif; min-width:150px; color:#000;">
                    <b style="font-size:1.1em;">${data.displayName}</b> 
                    <span style="font-size:0.85em; color:#06C167; font-weight:bold;">[${badge}]</span><br>
                    <span style="color:#545454; font-size:0.8em; display:block; margin:4px 0;">更新: ${timeStr} | 👍 応援: <b>${likes}</b>回</span>
                    ${data.statusMessage ? `<p style="margin:6px 0; font-size:0.95em; background:#F6F6F6; padding:8px; border-radius:6px; border:1px solid #E2E2E2;">「${data.statusMessage}」</p>` : ""}
                    <button onclick="sendLike('${data.displayName}')" class="popup-btn">👍 応援を送る</button>
                    <button onclick="window.openProfileModal('${data.displayName}', '${badge}')" class="popup-btn-outline">👤 プロフィールを見る</button>
                </div>
            `;
            marker.bindPopup(popupContent);
        });

        map.setView([myLat, myLng], 14);
    } catch (error) {
        console.error("読み込みエラー: ", error);
    }
}

window.sendLike = async (targetName) => {
    try {
        const targetDocRef = doc(db, "locations", targetName);
        await updateDoc(targetDocRef, { likesCount: increment(1) });
        alert(`${targetName} さんに応援を送信しました！👍`);
        
        // 自分のピンを叩いた時のためにドロワーとマーカーを即リロード
        if (targetName === currentUserName) {
            await updateMyProfileInDrawer();
        }
        // 地図上の数表示を最新にする
        const center = map.getCenter();
        await loadMarkers(center.lat, center.lng);
    } catch (error) {
        console.error("エラー: ", error);
    }
};

// ドロワー内のデータ取得 ＆ 応援数の反映①
async function updateMyProfileInDrawer() {
    try {
        const docSnap = await getDoc(doc(db, "locations", currentUserName));
        if (docSnap.exists()) {
            const data = docSnap.data();
            const count = data.checkInCount || 0;
            let badge = "🔰新米";
            if (count >= 30) badge = "👑レジェンド";
            else if (count >= 15) badge = "🏅ベテラン";
            else if (count >= 5) badge = "🚴中堅";

            document.getElementById('myProfileName').textContent = data.displayName;
            document.getElementById('myProfileMsg').textContent = data.statusMessage ? `「${data.statusMessage}」` : "（未設定）";
            document.getElementById('myProfileCount').textContent = count;
            document.getElementById('myProfileBadge').textContent = badge;
            // 💖 反映①: 自分の合計応援数をメニューに表示
            document.getElementById('myProfileLikes').textContent = data.likesCount || 0;
        }

        const profileSnap = await getDoc(doc(db, "profiles", currentUserName));
        if (profileSnap.exists()) {
            const pData = profileSnap.data();
            document.getElementById('readArea').textContent = pData.mainArea || "未設定";
            document.getElementById('readTime').textContent = pData.mainTime || "未設定";
            
            const tagsContainer = document.getElementById('readTags');
            tagsContainer.innerHTML = "";
            const allTags = [...(pData.vehicles || []), ...(pData.services || [])];
            if (allTags.length === 0) {
                tagsContainer.innerHTML = "<span style='font-size:0.85em; color:#767676;'>未設定</span>";
            } else {
                allTags.forEach(tagText => {
                    const span = document.createElement('span');
                    span.className = 'tag'; 
                    span.textContent = tagText;
                    tagsContainer.appendChild(span);
                });
            }

            document.getElementById('profileArea').value = pData.mainArea || "";
            document.getElementById('profileTime').value = pData.mainTime || "";
            
            document.querySelectorAll('input[name="vehicleTag"]').forEach(cb => {
                cb.checked = pData.vehicles ? pData.vehicles.includes(cb.value) : false;
            });
            document.querySelectorAll('input[name="serviceTag"]').forEach(cb => {
                cb.checked = pData.services ? pData.services.includes(cb.value) : false;
            });
        }
    } catch (error) {
        console.error("プロフィール取得エラー: ", error);
    }
}

// プロフィールモード切り替え
document.getElementById('editProfileBtn').addEventListener('click', () => {
    document.getElementById('profileReadMode').style.display = 'none';
    document.getElementById('profileEditMode').style.display = 'block';
});
document.getElementById('cancelEditBtn').addEventListener('click', () => {
    document.getElementById('profileEditMode').style.display = 'none';
    document.getElementById('profileReadMode').style.display = 'block';
});

document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    if (!currentUserName) return;
    const area = document.getElementById('profileArea').value.trim();
    const time = document.getElementById('profileTime').value.trim();
    const vehicles = Array.from(document.querySelectorAll('input[name="vehicleTag"]:checked')).map(el => el.value);
    const services = Array.from(document.querySelectorAll('input[name="serviceTag"]:checked')).map(el => el.value);

    try {
        await setDoc(doc(db, "profiles", currentUserName), {
            mainArea: area,
            mainTime: time,
            vehicles: vehicles,
            services: services,
            updatedAt: new Date()
        }, { merge: true });
        
        await updateMyProfileInDrawer();
        document.getElementById('profileEditMode').style.display = 'none';
        document.getElementById('profileReadMode').style.display = 'block';
        alert("プロフィールを保存しました！");
    } catch (error) {
        console.error("プロフィール保存エラー:", error);
    }
});

// 中央モーダルを開く ＆ 応援数の反映②
window.openProfileModal = async (targetName, badge) => {
    document.getElementById('modalName').textContent = targetName;
    document.getElementById('modalBadge').textContent = badge;
    document.getElementById('modalLikesCount').textContent = "-"; // 初期化
    
    document.getElementById('modalArea').textContent = "読み込み中...";
    document.getElementById('modalTime').textContent = "読み込み中...";
    const tagsContainer = document.getElementById('modalTags');
    tagsContainer.innerHTML = "";

    document.getElementById('modalOverlay').style.display = 'block';
    document.getElementById('profileModal').style.display = 'block';

    try {
        // 💖 反映②: locationsから最新の応援数を引っ張ってきてモーダルに表示
        const locSnap = await getDoc(doc(db, "locations", targetName));
        if (locSnap.exists()) {
            document.getElementById('modalLikesCount').textContent = locSnap.data().likesCount || 0;
        }

        const docSnap = await getDoc(doc(db, "profiles", targetName));
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('modalArea').textContent = data.mainArea || "未設定";
            document.getElementById('modalTime').textContent = data.mainTime || "未設定";
            
            const allTags = [...(data.vehicles || []), ...(data.services || [])];
            if (allTags.length === 0) {
                tagsContainer.innerHTML = "<span style='font-size:0.85em; color:#767676;'>未設定</span>";
            } else {
                allTags.forEach(tagText => {
                    const span = document.createElement('span');
                    span.className = 'tag'; 
                    span.textContent = tagText;
                    tagsContainer.appendChild(span);
                });
            }
        } else {
            document.getElementById('modalArea').textContent = "未設定";
            document.getElementById('modalTime').textContent = "未設定";
            tagsContainer.innerHTML = "<span style='font-size:0.85em; color:#767676;'>未設定</span>";
        }
    } catch (error) {
        console.error("プロフィール取得エラー:", error);
    }

    const likeBtn = document.getElementById('modalLikeBtn');
    likeBtn.onclick = () => {
        window.sendLike(targetName);
        document.getElementById('modalOverlay').style.display = 'none';
        document.getElementById('profileModal').style.display = 'none';
    };
};

document.getElementById('closeModalBtn').addEventListener('click', () => {
    document.getElementById('modalOverlay').style.display = 'none';
    document.getElementById('profileModal').style.display = 'none';
});
document.getElementById('modalOverlay').addEventListener('click', () => {
    document.getElementById('modalOverlay').style.display = 'none';
    document.getElementById('profileModal').style.display = 'none';
});

// 🆕 🗺️ 【新規】右下操作コントロールの処理群

// 1. 🎯 現在地に戻るボタン
document.getElementById('geoBackBtn').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition((position) => {
        map.setView([position.coords.latitude, position.coords.longitude], 16);
    }, () => {
        alert("現在地の取得に失敗しました。GPS設定を確認してください。");
    });
});

// 2. 📝 メモを残す（照準モード開始）
document.getElementById('addMemoModeBtn').addEventListener('click', () => {
    isMemoMode = true;
    document.getElementById('mapCenterTarget').style.display = 'block';      // 照準を表示
    document.getElementById('mapControlsContainer').style.display = 'none'; // 右下ボタンを隠す
    document.getElementById('memoActionPanel').style.display = 'block';     // 下部スライドを表示
    document.getElementById('memoPhaseLoc').style.display = 'block';
    document.getElementById('memoPhaseForm').style.display = 'none';
});

// 3. 📍 ここに決定する（フェーズ1 ➔ フェーズ2へ移行）
document.getElementById('btnConfirmLoc').addEventListener('click', () => {
    document.getElementById('memoPhaseLoc').style.display = 'none';
    document.getElementById('memoPhaseForm').style.display = 'block';
    document.getElementById('memoTextInput').value = ""; // 入力欄リセット
});

// 4. ❌ キャンセル処理（モードを完全に終了して元に戻す）
const closeMemoMode = () => {
    isMemoMode = false;
    document.getElementById('mapCenterTarget').style.display = 'none';
    document.getElementById('memoActionPanel').style.display = 'none';
    document.getElementById('mapControlsContainer').style.display = 'flex';
};
document.getElementById('btnCancelMemo').addEventListener('click', closeMemoMode);
document.getElementById('btnCancelForm').addEventListener('click', closeMemoMode);

// 5. 💾 メモをFirebaseに保存
document.getElementById('btnSaveMemo').addEventListener('click', async () => {
    const text = document.getElementById('memoTextInput').value.trim();
    if (!text) { alert("メモ内容を入力してください"); return; }

    const center = map.getCenter(); // 🎯 画面中央（照準）の緯度経度を取得
    const category = document.querySelector('input[name="memoCat"]:checked').value;
    
    try {
        await addDoc(collection(db, "memos"), {
            lat: center.lat,
            lng: center.lng,
            category: category,
            text: text,
            sender: currentUserName || "匿名ドバイバー",
            createdAt: new Date()
        });
        
        alert("攻略メモをマップに登録しました！");
        closeMemoMode();
        await loadMemos(); // メモピンを即座に再描画
    } catch (error) {
        console.error("メモ保存エラー:", error);
        alert("メモの保存に失敗しました。");
    }
});

// 6. 🌍 みんな ／ 👤 自分のメモ 切り替えトグル制御
document.getElementById('btnToggleAllMemos').addEventListener('click', async () => {
    document.getElementById('btnToggleAllMemos').classList.add('active');
    document.getElementById('btnToggleMyMemos').classList.remove('active');
    currentMemoFilter = "all";
    await loadMemos();
});
document.getElementById('btnToggleMyMemos').addEventListener('click', async () => {
    document.getElementById('btnToggleMyMemos').classList.add('active');
    document.getElementById('btnToggleAllMemos').classList.remove('active');
    currentMemoFilter = "mine";
    await loadMemos();
});

// 7. 📥 攻略メモデータをFirestoreから読み込んでピンを刺す
async function loadMemos() {
    try {
        const querySnapshot = await getDocs(collection(db, "memos"));
        memoMarkersLayer.clearLayers(); // 過去のメモピンを一旦全部消去

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            
            // 「自分のメモ」モードの時は、投稿者が自分でなければ非表示にする
            if (currentMemoFilter === "mine" && data.sender !== currentUserName) {
                return; 
            }

            // カテゴリの1文字目（絵文字）をアイコンとして抽出
            const emoji = data.category ? data.category.substring(0, 2) : "📝";

            const memoIcon = L.divIcon({
                className: 'memo-custom-pin',
                html: `<div>${emoji}</div>`,
                iconSize: [36, 36],
                iconAnchor: [18, 18],
                popupAnchor: [0, -18]
            });

            const marker = L.marker([data.lat, data.lng], { icon: memoIcon });
            marker.isMemo = true; // メモピン識別用

            // メモピン用のポップアップ内容（自分が書いたメモには削除ボタン🗑️をつける）
            let deleteBtnHtml = "";
            if (data.sender === currentUserName) {
                deleteBtnHtml = `<button onclick="deleteMemo('${docSnap.id}')" style="margin-top:8px; padding:4px 8px; background:none; border:1px solid #DC3545; color:#DC3545; border-radius:4px; font-size:0.8em; cursor:pointer; width:100%;">🗑️ このメモを削除</button>`;
            }

            const popupContent = `
                <div style="font-family:sans-serif; min-width:160px; color:#000;">
                    <b style="font-size:1.05em; color:#333;">${data.category}</b><br>
                    <span style="font-size:0.75em; color:#767676;">投稿者: ${data.sender}</span>
                    <p style="margin:6px 0 4px 0; font-size:0.95em; line-height:1.4; background:#FFF9E6; padding:8px; border-radius:6px; border:1px solid #FFEBAA; word-break:break-all;">${data.text}</p>
                    ${deleteBtnHtml}
                </div>
            `;
            marker.bindPopup(popupContent);
            memoMarkersLayer.addLayer(marker);
        });
    } catch (error) {
        console.error("メモ読み込みエラー:", error);
    }
}

// 8. 🗑️ 自分のメモを削除する処理
window.deleteMemo = async (memoId) => {
    if (!confirm("この攻略メモを削除してもよろしいですか？")) return;
    try {
        await deleteDoc(doc(db, "memos", memoId));
        alert("メモを削除しました。");
        map.closePopup();
        await loadMemos(); // 再読み込み
    } catch (error) {
        console.error("削除エラー:", error);
    }
};

// フィードバック送信
document.getElementById('submitOpinionBtn').addEventListener('click', async () => {
    const opinionText = document.getElementById('opinionInput').value.trim();
    if (!opinionText) { alert('ご意見を入力してください。'); return; }
    try {
        await addDoc(collection(db, "opinions"), {
            text: opinionText,
            sender: currentUserName || "匿名ユーザー",
            createdAt: new Date()
        });
        alert('フィードバックを送信しました。ご協力ありがとうございます！');
        document.getElementById('opinionInput').value = ""; 
    } catch (error) {
        console.error("エラー: ", error);
    }
});