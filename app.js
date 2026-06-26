import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDocs, updateDoc, increment, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";


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

const map = L.map('map').setView([35.6635, 139.8731], 14);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors, © CARTO',
    maxZoom: 20
}).addTo(map);

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
            // GPSの場合は現在時刻
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

        // テスト用の時間を設定（入力があればその時間、なければ現在時刻）
        let checkInTime = new Date();
        if (timeInput) {
            const [hours, minutes] = timeInput.split(':');
            checkInTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
        }

        await sendCheckIn(name, msg, lat, lng, checkInTime);
    }
});

// updatedAtを引数で受け取るように変更
async function sendCheckIn(name, msg, lat, lng, updateTime) {
    try {
        const userDocRef = doc(db, "locations", name);
        await setDoc(userDocRef, {
            displayName: name,
            statusMessage: msg, 
            latitude: lat,
            longitude: lng,
            updatedAt: updateTime, // ここにテスト用の時間が入る
            checkInCount: increment(1)
        }, { merge: true });

        document.getElementById('statusMessage').textContent = "";
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('mapPage').style.display = 'block';
        document.getElementById('userGreeting').textContent = `${name} さん`;
        
        map.invalidateSize(); 
        await loadMarkers(lat, lng);

    } catch (error) {
        console.error("エラー: ", error);
        alert('送信に失敗しました。');
    }
}

async function loadMarkers(myLat, myLng) {
    try {
        const querySnapshot = await getDocs(collection(db, "locations"));
        
        map.eachLayer((layer) => {
            if (layer instanceof L.Marker) map.removeLayer(layer);
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

            const marker = L.marker([displayLat, displayLng], { icon: customIcon }).addTo(map);

            const popupContent = `
                <div style="font-family:sans-serif; min-width:150px; color:#000;">
                    <b style="font-size:1.1em;">${data.displayName}</b> 
                    <span style="font-size:0.85em; color:#06C167; font-weight:bold;">[${badge}]</span><br>
                    <span style="color:#545454; font-size:0.8em; display:block; margin:4px 0;">更新: ${timeStr}</span>
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
    } catch (error) {
        console.error("エラー: ", error);
    }
};

// ドロワー内のデータ取得（閲覧モード用も含む）
async function updateMyProfileInDrawer() {
    try {
        // ① locations（ステータス情報）の取得
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
        }

        // ② profiles（基本情報）の取得
        const profileSnap = await getDoc(doc(db, "profiles", currentUserName));
        if (profileSnap.exists()) {
            const pData = profileSnap.data();
            
            // 閲覧モードに反映
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
                    span.className = 'tag'; // 色指定なしのシンプルタグ
                    span.textContent = tagText;
                    tagsContainer.appendChild(span);
                });
            }

            // 編集モード（入力欄）にも反映しておく
            document.getElementById('profileArea').value = pData.mainArea || "";
            document.getElementById('profileTime').value = pData.mainTime || "";
            
            // チェックボックスの状態を復元
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

// ✏️ プロフィール編集・キャンセル・保存の切り替え処理
document.getElementById('editProfileBtn').addEventListener('click', () => {
    document.getElementById('profileReadMode').style.display = 'none';
    document.getElementById('profileEditMode').style.display = 'block';
});
document.getElementById('cancelEditBtn').addEventListener('click', () => {
    document.getElementById('profileEditMode').style.display = 'none';
    document.getElementById('profileReadMode').style.display = 'block';
});

// プロフィールを保存
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
        
        // 保存したら自動的に閲覧モードに戻して最新データを表示
        await updateMyProfileInDrawer();
        document.getElementById('profileEditMode').style.display = 'none';
        document.getElementById('profileReadMode').style.display = 'block';

        alert("プロフィールを保存しました！");
    } catch (error) {
        console.error("プロフィール保存エラー:", error);
    }
});

// 👤 中央モーダルを開く（一言の表示を削除）
window.openProfileModal = async (targetName, badge) => {
    document.getElementById('modalName').textContent = targetName;
    document.getElementById('modalBadge').textContent = badge;
    
    document.getElementById('modalArea').textContent = "読み込み中...";
    document.getElementById('modalTime').textContent = "読み込み中...";
    const tagsContainer = document.getElementById('modalTags');
    tagsContainer.innerHTML = "";

    document.getElementById('modalOverlay').style.display = 'block';
    document.getElementById('profileModal').style.display = 'block';

    try {
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
                    span.className = 'tag'; // 色指定なしのシンプルタグ
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