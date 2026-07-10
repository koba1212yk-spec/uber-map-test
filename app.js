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

// 🌟 Google Maps API Key
const GOOGLE_API_KEY = "AIzaSyCT8iaIRKwSUfLDqvM8dBvshKNbwyz1B3E";

// 🌟 建物指定モードの管理変数
let isPickingBuilding = false; 
let was3dEnabledBeforePick = false;
let pitchBeforePick = 45;

let currentUserId = "anonymous";
let myProfileName = "";
let isNameLocked = false; 

let selectedImageDataUrls = []; 
let editingMemoId = null;       

let currentLocationMarker = null;
let tempPinMarker = null; 
let currentOpenMemoId = null;
let targetLngLat = null; 

let geoMode = 'A'; 
let geoZoomTimer = null;

let currentWatchCoords = null;
let watchPositionId = null;

let currentGroupMemos = [];
let currentGroupIndex = 0;

let filterState = { showMineOnly: false, categories: ['🏢 建物・入口', '🅿️ 駐輪スポット', '⚠️ 注意・取締り', '🚻 トイレ・公園', '💡 その他'] };
let allMemosData = []; 
let latestMemos = [];
let tickerIndex = 0;
let isTickerFlipped = false;

// 🌟 HTMLマーカー描画・管理用
let markersOnScreen = {};
const catIconPaths = {
    '🏢 建物・入口': '<path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/>',
    '🅿️ 駐輪スポット': '<path d="M13.2 11H10v2h3.2c1.1 0 2-.9 2-2s-.9-2-2-2zM8 4h5.2c2.21 0 4 1.79 4 4s-1.79 4-4 4H10v8H8V4z"/>',
    '⚠️ 注意・取締り': '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>',
    '🚻 トイレ・公園': '<path d="M20.5 6c-2.61.7-5.67 1-8.5 1s-5.89-.3-8.5-1L3 8c1.86.5 4 .83 6 1v13h2v-6h2v6h2V9c2-.17 4.14-.5 6-1l-.5-2zM12 6c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>',
    '💡 その他': '<path d="M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z"/>'
};
const catColors = { '🏢 建物・入口': '#1A73E8', '🅿️ 駐輪スポット': '#34A853', '⚠️ 注意・取締り': '#EA4335', '🚻 トイレ・公園': '#FBBC04', '💡 その他': '#9AA0A6' };

const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16); const g = parseInt(hex.slice(3, 5), 16); const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

localStorage.setItem('deliMapActiveTab', 'tabMap');
let localName = localStorage.getItem('deliMapTempName');
if (!localName) { const seedId = Math.floor(1000 + Math.random() * 9000); localName = `名無し配達員(${seedId})`; localStorage.setItem('deliMapTempName', localName); }
myProfileName = localName;
document.getElementById('readName').textContent = myProfileName; document.getElementById('profileName').value = myProfileName;

signInAnonymously(auth).then((userCredential) => { currentUserId = userCredential.user.uid; loadProfile(); }).catch(e => console.error(e));

// 🌟 建物入力セクションの表示切り替えロジック
document.querySelectorAll('input[name="memoCatInput"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const section = document.getElementById('buildingInputSection');
        if (e.target.value === '🏢 建物・入口') { section.style.display = 'block'; } 
        else { section.style.display = 'none'; }
    });
});

function updateCurrentLocation(coords) {
    if (!currentLocationMarker) {
        const el = document.createElement('div'); el.className = 'current-location-dot';
        const cone = document.createElement('div'); cone.className = 'heading-cone'; cone.id = 'headingCone';
        if (geoMode === 'C') cone.classList.add('show'); el.appendChild(cone);
        currentLocationMarker = new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map);
    } else { currentLocationMarker.setLngLat(coords); }
}

function startLocationTracking() {
    if (navigator.geolocation) {
        watchPositionId = navigator.geolocation.watchPosition(
            (pos) => {
                currentWatchCoords = [pos.coords.longitude, pos.coords.latitude];
                updateCurrentLocation(currentWatchCoords);
                
                const actionPanel = document.getElementById('memoActionPanel');
                if (actionPanel && actionPanel.classList.contains('show') && !targetLngLat && !editingMemoId) {
                    targetLngLat = { lng: currentWatchCoords[0], lat: currentWatchCoords[1] };
                    if (tempPinMarker) tempPinMarker.remove();
                    const wrapper = document.createElement('div'); wrapper.className = 'marker-wrapper';
                    const pin = document.createElement('div'); pin.className = 'sharp-temp-pin pop-animation'; wrapper.appendChild(pin);
                    tempPinMarker = new maplibregl.Marker({ element: wrapper, anchor: 'bottom' }).setLngLat(targetLngLat).addTo(map);
                    map.flyTo({ center: targetLngLat, zoom: 20, padding: { top: 90, bottom: 450, left: 0, right: 0 }, duration: 800 });
                    document.getElementById('memoTextInput').placeholder = "タワマンの入り口は裏手です、等";
                }
            },
            (err) => { console.error("GPSエラー:", err); },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
    }
}

function setGeoMode(mode) {
    geoMode = mode;
    const iconTarget = document.getElementById('geoIconTarget'); const iconCompass = document.getElementById('geoIconCompass'); let cone = document.getElementById('headingCone');
    if (!cone && mode === 'C') { const dot = document.querySelector('.current-location-dot'); if (dot) { cone = document.createElement('div'); cone.className = 'heading-cone'; cone.id = 'headingCone'; dot.appendChild(cone); } }
    if (iconTarget && iconCompass) {
        if (mode === 'A') { iconTarget.style.display = 'block'; iconCompass.style.display = 'none'; if (cone) cone.classList.remove('show'); stopCompass(); } 
        else if (mode === 'B') { iconTarget.style.display = 'none'; iconCompass.style.display = 'block'; iconCompass.setAttribute('fill', '#5F6368'); if (cone) cone.classList.remove('show'); stopCompass(); } 
        else if (mode === 'C') { iconTarget.style.display = 'none'; iconCompass.style.display = 'block'; iconCompass.setAttribute('fill', '#1A73E8'); if (cone) cone.classList.add('show'); startCompass(); }
    }
}

function jumpToCurrentLocation() {
    if (currentWatchCoords) {
        map.flyTo({ center: currentWatchCoords, zoom: 16, duration: 800 });
        fetchWeatherData(currentWatchCoords[1], currentWatchCoords[0], false);
        clearTimeout(geoZoomTimer); geoZoomTimer = setTimeout(() => { setGeoMode('B'); }, 850);
    } else {
        navigator.geolocation.getCurrentPosition(pos => {
            const coords = [pos.coords.longitude, pos.coords.latitude]; currentWatchCoords = coords;
            map.flyTo({ center: coords, zoom: 16, duration: 800 });
            updateCurrentLocation(coords); fetchWeatherData(pos.coords.latitude, pos.coords.longitude, false);
            clearTimeout(geoZoomTimer); geoZoomTimer = setTimeout(() => { setGeoMode('B'); }, 850);
        });
    }
}

async function startCompass() { if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') { try { const permission = await DeviceOrientationEvent.requestPermission(); if (permission !== 'granted') return; } catch (e) { console.error(e); } } window.addEventListener('deviceorientationabsolute', handleOrientation, true); window.addEventListener('deviceorientation', handleOrientation, true); }
function stopCompass() { window.removeEventListener('deviceorientationabsolute', handleOrientation, true); window.removeEventListener('deviceorientation', handleOrientation, true); }
function handleOrientation(e) { const cone = document.getElementById('headingCone'); if (!cone || geoMode !== 'C') return; let heading = null; if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) { heading = e.webkitCompassHeading; } else if ((e.absolute === true || e.type === 'deviceorientationabsolute') && e.alpha !== null) { heading = 360 - e.alpha; } if (heading !== null) { const mapBearing = map.getBearing(); const finalRotation = heading - mapBearing; cone.style.transform = `translateX(-50%) rotate(${Math.round(finalRotation)}deg)`; } }

// ==========================================
// 🗺️ MapTiler
// ==========================================
const MAPTILER_KEY = "R7X03ziyuOxnZBBvDL0G";
const map = new maplibregl.Map({ container: 'map', style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`, center: [139.8731, 35.6635], zoom: 14, pitch: 45, attributionControl: false });

map.on('load', () => {
    startLocationTracking(); jumpToCurrentLocation();
    
    const layers = map.getStyle().layers;
    layers.forEach(layer => { if (layer.type === 'fill-extrusion') { map.setLayoutProperty(layer.id, 'visibility', 'none'); } });

    map.addSource('memos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 14, clusterRadius: 50 });
    map.addLayer({ id: 'clusters', type: 'circle', source: 'memos', filter: ['has', 'point_count'], paint: { 'circle-color': '#06C167', 'circle-radius': 18, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
    map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'memos', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 14, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#ffffff' } });

    document.getElementById('chk3dBuilding').addEventListener('change', (e) => {
        const show = e.target.checked; const currentLayers = map.getStyle().layers;
        currentLayers.forEach(layer => { if (layer.type === 'fill-extrusion') { map.setLayoutProperty(layer.id, 'visibility', show ? 'visible' : 'none'); } });
    });

    map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        map.getSource('memos').getClusterExpansionZoom(features[0].properties.cluster_id, (err, zoom) => { if (!err) map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom }); });
    });

    // 🌟 マップの空き地・建物をタップした時の処理
    map.on('click', async (e) => {
        // 🎯 建物指定モード中なら、API取得処理へ分岐
        if (isPickingBuilding) {
            isPickingBuilding = false;
            targetLngLat = e.lngLat;
            
            // 🌟 3Dモードとカメラ角度を元に戻す
            if (map.getLayer('3d-buildings')) {
                map.setLayoutProperty('3d-buildings', 'visibility', was3dEnabledBeforePick ? 'visible' : 'none');
            }
            
            // タップした場所にピンを移動し、パネルを戻す
            if (tempPinMarker) {
                tempPinMarker.setLngLat(targetLngLat);
            } else {
                const wrapper = document.createElement('div'); wrapper.className = 'marker-wrapper';
                const pin = document.createElement('div'); pin.className = 'sharp-temp-pin pop-animation'; wrapper.appendChild(pin);
                tempPinMarker = new maplibregl.Marker({ element: wrapper, anchor: 'bottom' }).setLngLat(targetLngLat).addTo(map);
            }
            
            map.flyTo({ center: targetLngLat, pitch: pitchBeforePick, zoom: 19, padding: { top: 90, bottom: 450, left: 0, right: 0 }, duration: 800 });
            
            // パネルを全開に戻す
            const actionPanel = document.getElementById('memoActionPanel');
            actionPanel.classList.remove('peek-low');
            
            // 🌟 Google API呼び出し
            document.getElementById('memoBuildingName').value = "⏳ 取得中..."; document.getElementById('memoAddress').value = "⏳ 取得中...";
            try {
                const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${targetLngLat.lat},${targetLngLat.lng}&key=${GOOGLE_API_KEY}&language=ja`);
                const data = await res.json();
                let bName = ""; let address = "";
                
                if (data.status === "OK" && data.results.length > 0) {
                    const bestResult = data.results[0];
                    address = bestResult.formatted_address.replace(/^日本、\s*(〒\d{3}-\d{4}\s*)?/, '');
                    
                    const premise = bestResult.address_components.find(c => c.types.includes('premise') || c.types.includes('establishment'));
                    if (premise) {
                        bName = premise.long_name;
                        address = address.replace(bName, '').trim();
                    } else if (data.results.length > 1) {
                        const poiResult = data.results.find(r => r.types.includes('point_of_interest') || r.types.includes('premise') || r.types.includes('establishment'));
                        if (poiResult) { bName = poiResult.address_components[0].long_name; }
                    }
                }
                document.getElementById('memoBuildingName').value = bName || "";
                document.getElementById('memoAddress').value = address || "";
            } catch(err) {
                console.error(err);
                document.getElementById('memoBuildingName').value = ""; document.getElementById('memoAddress').value = "";
            }
            return;
        }

        // 通常のマップクリック時
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        if (!features.length) {
            const sheet = document.getElementById('memoBottomSheet'); if (sheet.classList.contains('show')) sheet.classList.add('peek');
            const actionPanel = document.getElementById('memoActionPanel'); if (actionPanel && actionPanel.classList.contains('show')) actionPanel.classList.add('peek');
            document.getElementById('filterBottomSheet').classList.remove('show');
            if (tempPinMarker) { tempPinMarker.remove(); tempPinMarker = null; }
        }
    });

    let touchTimer; map.on('touchstart', (e) => { if (e.originalEvent.touches.length > 1) return; touchTimer = setTimeout(() => { openMemoAddSheet(e.lngLat, false); }, 500); });
    map.on('touchmove', () => clearTimeout(touchTimer)); map.on('touchend', () => clearTimeout(touchTimer)); map.on('contextmenu', (e) => { openMemoAddSheet(e.lngLat, false); });

    loadMemosToMap();
});

// 🌟 ピンの光るオーラ表現（案A）の実装
function updateMarkers() {
    if (!map.getSource('memos')) return;
    const newMarkers = {};
    const features = map.querySourceFeatures('memos');
    
    for (const feature of features) {
        if (!feature.properties.cluster) {
            const id = feature.properties.id; const coords = feature.geometry.coordinates;
            
            if (!markersOnScreen[id]) {
                const isSelected = feature.properties.isSelected; const cat = feature.properties.category || '💡 その他';
                const wrapper = document.createElement('div'); wrapper.className = 'marker-wrapper';
                const el = document.createElement('div'); el.className = `custom-memo-marker pop-animation ${isSelected ? 'selected' : ''}`;
                
                el.style.backgroundColor = catColors[cat];
                el.style.setProperty('--cat-color', catColors[cat]); el.style.setProperty('--cat-color-alpha', hexToRgba(catColors[cat], 0.4));
                el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="#FFFFFF">${catIconPaths[cat]}</svg>`;
                wrapper.appendChild(el); const marker = new maplibregl.Marker({element: wrapper}).setLngLat(coords).addTo(map);
                
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const currentFeatures = map.querySourceFeatures('memos').filter(f => !f.properties.cluster);
                    const clickedMemos = currentFeatures.filter(f => Math.abs(f.geometry.coordinates[0] - coords[0]) < 0.0001 && Math.abs(f.geometry.coordinates[1] - coords[1]) < 0.0001);
                    const uniqueIds = new Set(); currentGroupMemos = [];
                    clickedMemos.forEach(f => { if (!uniqueIds.has(f.properties.id)) { uniqueIds.add(f.properties.id); currentGroupMemos.push(f.properties); } });
                    currentGroupIndex = 0; showCurrentGroupMemo();
                });
                markersOnScreen[id] = { marker: marker, el: el };
            } else {
                const markerObj = markersOnScreen[id]; const el = markerObj.el; const isSelected = feature.properties.isSelected;
                if (isSelected && !el.classList.contains('selected')) { el.classList.add('selected'); } else if (!isSelected && el.classList.contains('selected')) { el.classList.remove('selected'); }
                markerObj.marker.setLngLat(coords); 
            }
            newMarkers[id] = markersOnScreen[id];
        }
    }
    for (const id in markersOnScreen) { if (!newMarkers[id]) { markersOnScreen[id].marker.remove(); delete markersOnScreen[id]; } }
}
map.on('render', updateMarkers);


// ==========================================
// 🔍 🌟 ハイブリッド検索 (Firebase内検索 ＋ Nominatim)
// ==========================================
const searchInput = document.getElementById('addressSearchInput');
const searchSuggestions = document.getElementById('searchSuggestions');
let searchTimeout = null;

function formatJapaneseAddress(displayName) { return displayName.split(', ').reverse().join(' ').replace(/日本/g, '').replace(/〒\d{3}-\d{4}/g, '').trim(); }

if (searchInput && searchSuggestions) {
    searchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim(); clearTimeout(searchTimeout);
        if (!q) { searchSuggestions.style.display = 'none'; return; }
        
        searchTimeout = setTimeout(async () => {
            searchSuggestions.innerHTML = '';
            let hasResults = false;

            // 🌟 1. Firebase内のみんなのメモから瞬時に検索
            const localMatches = allMemosData.filter(m => {
                if (!q) return false;
                const matchText = (m.buildingName || "") + " " + (m.address || "") + " " + (m.text || "");
                return matchText.toLowerCase().includes(q.toLowerCase());
            }).slice(0, 3);

            if (localMatches.length > 0) {
                hasResults = true;
                const groupLabel = document.createElement('div');
                groupLabel.style.padding = '8px 16px'; groupLabel.style.fontSize = '0.8em'; groupLabel.style.background = '#E8F0FE'; groupLabel.style.color = '#1A73E8'; groupLabel.style.fontWeight = 'bold';
                groupLabel.textContent = '📝 みんなの攻略メモ';
                searchSuggestions.appendChild(groupLabel);

                localMatches.forEach(m => {
                    const div = document.createElement('div'); div.className = 'suggestion-item';
                    const emoji = m.category ? m.category.substring(0, 2) : "📍";
                    const title = m.buildingName || "メモ情報";
                    const sub = m.address || m.text.substring(0, 15);
                    div.innerHTML = `<span class="suggestion-icon">${emoji}</span><div style="line-height:1.4;"><strong>${title}</strong><br><span style="font-size:0.8em;color:#5F6368;">${sub}</span></div>`;
                    div.onclick = () => {
                        map.flyTo({ center: [m.lng, m.lat], zoom: 18 });
                        searchSuggestions.style.display = 'none'; searchInput.blur();
                        openMemoBottomSheet(m);
                    };
                    searchSuggestions.appendChild(div);
                });
            }

            // 🌟 2. Nominatim（世界地図データ）を検索
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=jp&addressdetails=1&limit=5`);
                const data = await res.json();
                
                if (data.length > 0) {
                    hasResults = true;
                    if (localMatches.length > 0) {
                        const groupLabel = document.createElement('div');
                        groupLabel.style.padding = '8px 16px'; groupLabel.style.fontSize = '0.8em'; groupLabel.style.background = '#F1F3F4'; groupLabel.style.color = '#5F6368'; groupLabel.style.fontWeight = 'bold';
                        groupLabel.textContent = '📍 地図・住所';
                        searchSuggestions.appendChild(groupLabel);
                    }

                    data.forEach(item => {
                        const div = document.createElement('div'); div.className = 'suggestion-item';
                        const formattedAddress = formatJapaneseAddress(item.display_name);
                        const nameHtml = item.name ? `<strong>${item.name}</strong><br><span style="font-size:0.8em;color:#5F6368;">${formattedAddress}</span>` : formattedAddress;
                        div.innerHTML = `<span class="suggestion-icon">📍</span><div style="line-height:1.4;">${nameHtml}</div>`;
                        div.onclick = () => {
                            map.flyTo({ center: [parseFloat(item.lon), parseFloat(item.lat)], zoom: 16 });
                            searchInput.value = item.name ? item.name : formattedAddress.split(' ')[0];
                            searchSuggestions.style.display = 'none'; searchInput.blur();
                        };
                        searchSuggestions.appendChild(div);
                    });
                }
            } catch(err) { console.error("検索エラー:", err); }
            
            if (hasResults) { searchSuggestions.style.display = 'block'; } else { searchSuggestions.style.display = 'none'; }
        }, 500); 
    });

    searchInput.addEventListener('keypress', async (e) => { 
        if(e.key === 'Enter') {
            const q = searchInput.value.trim(); if (!q) return;
            try {
                const localMatch = allMemosData.find(m => {
                    const matchText = (m.buildingName || "") + " " + (m.address || "") + " " + (m.text || "");
                    return matchText.toLowerCase().includes(q.toLowerCase());
                });
                
                if (localMatch) {
                    map.flyTo({ center: [localMatch.lng, localMatch.lat], zoom: 18 });
                    searchSuggestions.style.display = 'none'; searchInput.blur();
                    openMemoBottomSheet(localMatch);
                    return;
                }

                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=jp&limit=1`);
                const data = await res.json();
                if(data.length > 0) {
                    map.flyTo({ center: [parseFloat(data[0].lon), parseFloat(data[0].lat)], zoom: 16 });
                    searchSuggestions.style.display = 'none'; searchInput.blur();
                } else { alert("見つかりませんでした"); }
            } catch (err) {}
        } 
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchSuggestions.contains(e.target)) { searchSuggestions.style.display = 'none'; }
    });
}

const geoBackBtn = document.getElementById('geoBackBtn');
if (geoBackBtn) { geoBackBtn.addEventListener('click', () => { if (geoMode === 'A') { jumpToCurrentLocation(); } else if (geoMode === 'B') { map.flyTo({ zoom: 20, duration: 800 }); setGeoMode('C'); } else if (geoMode === 'C') { setGeoMode('B'); } }); }

// ==========================================
// 📝 🌟 メモUIアクション関連
// ==========================================
const btnQuickMemo = document.getElementById('btnQuickMemo');
if (btnQuickMemo) {
    btnQuickMemo.addEventListener('click', () => {
        const coords = currentWatchCoords || (currentLocationMarker ? [currentLocationMarker.getLngLat().lng, currentLocationMarker.getLngLat().lat] : null);
        if (coords) { openMemoAddSheet({ lng: coords[0], lat: coords[1] }, true); } else { openMemoAddSheet(null, false); }
    });
}

// 🌟 建物を指定ボタンの処理（一時的3Dモード ＆ パネル完全退避）
document.getElementById('btnPickBuilding').addEventListener('click', () => {
    isPickingBuilding = true;
    const actionPanel = document.getElementById('memoActionPanel');
    actionPanel.classList.remove('peek');
    actionPanel.classList.add('peek-low'); 
    
    // 現在の3D状態と角度を記憶
    was3dEnabledBeforePick = document.getElementById('chk3dBuilding').checked;
    pitchBeforePick = map.getPitch();

    // 一時的に3Dモードを強制ON＆カメラを深く寝かせる
    if (map.getLayer('3d-buildings')) {
        map.setLayoutProperty('3d-buildings', 'visibility', 'visible');
    }
    map.easeTo({ pitch: 60, duration: 800 });
    
    // トーストで案内を出す
    const toast = document.getElementById('materialToast');
    const originalHtml = toast.innerHTML;
    toast.innerHTML = `<div class="toast-icon">🎯</div><div class="toast-text" style="line-height:1.4;">3Dの建物モデルを<br>タップしてください</div>`;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.innerHTML = originalHtml, 500); }, 3500);
});

// パネルをタップした時の制御（下がりきった状態からでも元に戻せるように）
const actionPanel = document.getElementById('memoActionPanel');
if (actionPanel) { 
    actionPanel.addEventListener('click', (e) => { 
        if (e.target.id !== 'btnCancelForm' && (actionPanel.classList.contains('peek') || actionPanel.classList.contains('peek-low'))) { 
            actionPanel.classList.remove('peek'); 
            if (actionPanel.classList.contains('peek-low')) {
                actionPanel.classList.remove('peek-low');
                if (isPickingBuilding) {
                    isPickingBuilding = false;
                    if (map.getLayer('3d-buildings')) { map.setLayoutProperty('3d-buildings', 'visibility', was3dEnabledBeforePick ? 'visible' : 'none'); }
                    map.easeTo({ pitch: pitchBeforePick, duration: 800 });
                }
            }
        } 
    }); 
}

function handleMapInteraction(e) {
    if (!e.originalEvent) return; clearTimeout(geoZoomTimer); if (geoMode !== 'C') setGeoMode('A');
    const sheet = document.getElementById('memoBottomSheet'); if (sheet && sheet.classList.contains('show')) sheet.classList.add('peek'); 
    const panel = document.getElementById('memoActionPanel'); 
    if (panel && panel.classList.contains('show') && !panel.classList.contains('peek-low')) panel.classList.add('peek');
}
map.on('dragstart', handleMapInteraction); map.on('zoomstart', handleMapInteraction);

const tabs = { 'tabMap': 'mapPage', 'tabSupport': 'supportPage', 'tabProfile': 'profilePage' };
Object.keys(tabs).forEach(tabId => {
    const el = document.getElementById(tabId);
    if(el) { el.addEventListener('click', () => { document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active')); el.classList.add('active'); document.querySelectorAll('.page-section').forEach(p => p.style.display = 'none'); document.getElementById(tabs[tabId]).style.display = 'block'; if(tabId === 'tabMap') map.resize(); }); }
});

setInterval(() => {
    if (latestMemos.length === 0) return; const content = document.getElementById('tickerContent'); const backFace = document.getElementById('tickerBack');
    if (isTickerFlipped) { content.classList.remove('flipped'); tickerIndex = (tickerIndex + 1) % latestMemos.length; } 
    else { const memo = latestMemos[tickerIndex]; const emoji = memo.category ? memo.category.substring(0, 2) : "📝"; backFace.textContent = `${emoji} ${memo.text || memo.category}`; content.classList.add('flipped'); }
    isTickerFlipped = !isTickerFlipped;
}, 3500);

document.getElementById('tickerClickArea').addEventListener('click', () => {
    if (latestMemos.length === 0) return; const targetMemo = isTickerFlipped ? latestMemos[tickerIndex] : latestMemos[(tickerIndex === 0 ? latestMemos.length - 1 : tickerIndex - 1)];
    map.flyTo({ center: [targetMemo.lng, targetMemo.lat], zoom: 16 }); openMemoBottomSheet(targetMemo);
});

async function loadProfile() {
    try {
        const snap = await getDoc(doc(db, "profiles", currentUserId));
        if (snap.exists()) {
            const pData = snap.data(); myProfileName = pData.displayName || myProfileName; isNameLocked = pData.nameChanged || false;
            document.getElementById('readName').textContent = myProfileName; document.getElementById('profileName').value = myProfileName;
            if (isNameLocked) { document.getElementById('nameChangeWarning').style.display = 'none'; document.getElementById('profileName').disabled = true; }
            document.getElementById('readArea').textContent = pData.mainArea || "未設定"; document.getElementById('readTime').textContent = pData.mainTime || "未設定"; document.getElementById('readTotalLikes').textContent = pData.totalLikes || 0;
            const tagsContainer = document.getElementById('readTags'); tagsContainer.innerHTML = ""; const allTags = [...(pData.vehicles || []), ...(pData.services || [])];
            if (allTags.length === 0) tagsContainer.innerHTML = "<span style='font-size:0.85em; color:#71767B;'>未設定</span>"; else allTags.forEach(tag => { const span = document.createElement('span'); span.className = 'tag'; span.textContent = tag; tagsContainer.appendChild(span); });
            document.getElementById('profileArea').value = pData.mainArea || ""; document.getElementById('profileTime').value = pData.mainTime || ""; document.querySelectorAll('input[name="vehicleTag"]').forEach(cb => cb.checked = pData.vehicles?.includes(cb.value)); document.querySelectorAll('input[name="serviceTag"]').forEach(cb => cb.checked = pData.services?.includes(cb.value));
        } else { await setDoc(doc(db, "profiles", currentUserId), { displayName: myProfileName, nameChanged: false }, { merge: true }); }
    } catch (e) {}
}

document.getElementById('editProfileBtn').addEventListener('click', () => { document.getElementById('profileReadMode').style.display = 'none'; document.getElementById('profileEditMode').style.display = 'block'; });
document.getElementById('cancelEditBtn').addEventListener('click', () => { document.getElementById('profileEditMode').style.display = 'none'; document.getElementById('profileReadMode').style.display = 'block'; });
document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    let finalName = document.getElementById('profileName').value.trim() || myProfileName; const area = document.getElementById('profileArea').value.trim(); const time = document.getElementById('profileTime').value.trim();
    const vehicles = Array.from(document.querySelectorAll('input[name="vehicleTag"]:checked')).map(el => el.value); const services = Array.from(document.querySelectorAll('input[name="serviceTag"]:checked')).map(el => el.value);
    let lockFlag = isNameLocked; if (!isNameLocked && finalName !== myProfileName) lockFlag = true;
    try { await setDoc(doc(db, "profiles", currentUserId), { displayName: finalName, mainArea: area, mainTime: time, vehicles: vehicles, services: services, nameChanged: lockFlag, updatedAt: new Date() }, { merge: true }); localStorage.setItem('deliMapTempName', finalName); await loadProfile(); document.getElementById('profileEditMode').style.display = 'none'; document.getElementById('profileReadMode').style.display = 'block'; } catch (error) {}
});

document.getElementById('submitOpinionBtn').addEventListener('click', async () => { const text = document.getElementById('opinionInput').value.trim(); if (!text) return; try { await addDoc(collection(db, "opinions"), { text: text, senderId: currentUserId, createdAt: new Date() }); alert('送信完了！ご協力ありがとうございます。'); document.getElementById('opinionInput').value = ""; } catch (e) {} });

function compressImage(file, maxWidth = 800) {
    return new Promise((resolve) => {
        const reader = new FileReader(); reader.onload = (e) => { const img = new Image(); img.onload = () => { const canvas = document.createElement('canvas'); let width = img.width; let height = img.height; if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; } canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(img, 0, 0, width, height); resolve(canvas.toDataURL('image/jpeg', 0.7)); }; img.src = e.target.result; }; reader.readAsDataURL(file);
    });
}

const filterCats = ['🏢 建物・入口', '🅿️ 駐輪スポット', '⚠️ 注意・取締り', '🚻 トイレ・公園', '💡 その他'];
const filterContainer = document.getElementById('filterCategoryContainer');
filterCats.forEach(cat => { filterContainer.innerHTML += `<label class="cat-chip"><input type="checkbox" value="${cat}" checked><span>${cat.substring(0, 2)} ${cat.substring(3)}</span></label>`; });

document.getElementById('btnFilterMemo').addEventListener('click', () => { document.getElementById('memoBottomSheet').classList.remove('show'); document.getElementById('memoActionPanel').classList.remove('show'); document.getElementById('filterBottomSheet').classList.add('show'); });
document.getElementById('btnCloseFilter').addEventListener('click', () => { document.getElementById('filterBottomSheet').classList.remove('show'); });
document.getElementById('chkShowMineOnly').addEventListener('change', () => { filterState.showMineOnly = document.getElementById('chkShowMineOnly').checked; applyFilters(); });
filterContainer.addEventListener('change', () => { filterState.categories = Array.from(filterContainer.querySelectorAll('input:checked')).map(cb => cb.value); applyFilters(); });

function openMemoAddSheet(lngLat, zoomIn = false) {
    targetLngLat = lngLat; editingMemoId = null; 
    if (tempPinMarker) { tempPinMarker.remove(); tempPinMarker = null; }
    
    document.getElementById('memoBottomSheet').classList.remove('show'); 
    document.getElementById('filterBottomSheet').classList.remove('show'); 
    const panel = document.getElementById('memoActionPanel'); 
    panel.classList.remove('peek'); panel.classList.remove('peek-low'); panel.classList.add('show');
    
    // 🌟 建物入力欄のリセットと表示判定
    document.getElementById('memoBuildingName').value = "";
    document.getElementById('memoAddress').value = "";
    const catInput = document.querySelector('input[name="memoCatInput"]:checked');
    document.getElementById('buildingInputSection').style.display = (catInput && catInput.value === '🏢 建物・入口') ? 'block' : 'none';
    
    if (lngLat) {
        const wrapper = document.createElement('div'); wrapper.className = 'marker-wrapper';
        const pin = document.createElement('div'); pin.className = 'sharp-temp-pin pop-animation'; 
        wrapper.appendChild(pin);
        
        tempPinMarker = new maplibregl.Marker({ element: wrapper, anchor: 'bottom' }).setLngLat(lngLat).addTo(map);
        
        const cameraOptions = { center: lngLat, padding: { top: 90, bottom: 450, left: 0, right: 0 }, duration: 800 };
        if (zoomIn) cameraOptions.zoom = 20;
        map.flyTo(cameraOptions);
        
        document.getElementById('memoTextInput').placeholder = "タワマンの入り口は裏手です、等";
    } else {
        document.getElementById('memoTextInput').placeholder = "📍 GPSを取得中... メモを先に入力できます";
    }
}

const closeMemoForm = () => { 
    const panel = document.getElementById('memoActionPanel'); 
    panel.classList.remove('show'); panel.classList.remove('peek'); panel.classList.remove('peek-low');
    
    // 🌟 選択モード中にキャンセルした場合の後始末
    if (isPickingBuilding) {
        if (map.getLayer('3d-buildings')) { map.setLayoutProperty('3d-buildings', 'visibility', was3dEnabledBeforePick ? 'visible' : 'none'); }
        map.easeTo({ pitch: pitchBeforePick, duration: 800 });
        isPickingBuilding = false;
    }

    document.getElementById('btnRemoveImage').click(); 
    document.getElementById('memoTextInput').value = ""; 
    document.getElementById('memoBuildingName').value = ""; 
    document.getElementById('memoAddress').value = ""; 
    editingMemoId = null; 
    if (tempPinMarker) { tempPinMarker.remove(); tempPinMarker = null; } 
};
document.getElementById('btnCancelForm').addEventListener('click', closeMemoForm);

async function handleMemoImage(file, btnTextId, defaultText) {
    if (!file) return; if (selectedImageDataUrls.length >= 3) { alert("画像は最大3枚までです"); return; }
    document.getElementById(btnTextId).textContent = "⏳ 圧縮中"; const compressedData = await compressImage(file); selectedImageDataUrls.push(compressedData); 
    document.getElementById('memoImagePreview').src = selectedImageDataUrls[selectedImageDataUrls.length - 1]; document.getElementById('memoImagePreviewContainer').style.display = 'block'; 
    let countLabel = document.getElementById('memoImageCountLabel'); if(!countLabel) { countLabel = document.createElement('div'); countLabel.id = 'memoImageCountLabel'; countLabel.style.textAlign = 'center'; countLabel.style.fontSize = '12px'; countLabel.style.color = '#1A73E8'; countLabel.style.fontWeight = 'bold'; countLabel.style.marginTop = '4px'; document.getElementById('memoImagePreviewContainer').appendChild(countLabel); } countLabel.textContent = `${selectedImageDataUrls.length}枚選択中 (最大3枚)`;
    if (selectedImageDataUrls.length >= 3) { document.getElementById('memoCameraBtnText').parentNode.style.display = 'none'; document.getElementById('memoImageBtnText').parentNode.style.display = 'none'; } document.getElementById(btnTextId).textContent = defaultText;
}

document.getElementById('memoCameraInput').addEventListener('change', (e) => handleMemoImage(e.target.files[0], 'memoCameraBtnText', '📷 撮影')); 
document.getElementById('memoImageInput').addEventListener('change', (e) => handleMemoImage(e.target.files[0], 'memoImageBtnText', '📁 画像'));
document.getElementById('btnRemoveImage').addEventListener('click', () => { selectedImageDataUrls = []; document.getElementById('memoImageInput').value = ""; document.getElementById('memoCameraInput').value = ""; document.getElementById('memoImagePreviewContainer').style.display = 'none'; document.getElementById('memoCameraBtnText').parentNode.style.display = 'inline-block'; document.getElementById('memoImageBtnText').parentNode.style.display = 'inline-block'; const countLabel = document.getElementById('memoImageCountLabel'); if(countLabel) countLabel.textContent = ""; });

document.getElementById('btnSaveMemo').addEventListener('click', async () => {
    const text = document.getElementById('memoTextInput').value.trim(); 
    const catInput = document.querySelector('input[name="memoCatInput"]:checked'); const category = catInput ? catInput.value : '💡 その他';
    
    // 🌟 建物カテゴリ時は名前かテキスト必須
    let bName = ""; let addr = "";
    if (category === '🏢 建物・入口') {
        bName = document.getElementById('memoBuildingName').value.trim();
        addr = document.getElementById('memoAddress').value.trim();
    }

    if (!text && !bName && selectedImageDataUrls.length === 0) { alert("入力必須です"); return; }
    
    if (!targetLngLat) { alert("現在地を取得中です。電波の良い場所で再度お試しください。"); return; }

    const isShowName = document.getElementById('chkShowName').checked; const finalSenderName = isShowName ? myProfileName : "匿名ドライバー";
    const saveBtn = document.getElementById('btnSaveMemo'); saveBtn.disabled = true; saveBtn.textContent = "⏳ 送信中";
    
    try {
        let finalUrls = []; 
        for (let i = 0; i < selectedImageDataUrls.length; i++) {
            const dataUrl = selectedImageDataUrls[i];
            if (dataUrl.startsWith('http')) { finalUrls.push(dataUrl); } else { const storageRef = ref(storage, `memos/${Date.now()}_${currentUserId}_${i}.jpg`); await uploadString(storageRef, dataUrl, 'data_url'); finalUrls.push(await getDownloadURL(storageRef)); }
        }
        
        // 🌟 buildingName と address を保存データに追加
        const memoData = { 
            lat: targetLngLat.lat, lng: targetLngLat.lng, 
            category: category, text: text, 
            buildingName: bName, address: addr,
            imageUrls: finalUrls, imageUrl: finalUrls.length > 0 ? finalUrls[0] : null, 
            senderId: currentUserId, senderName: finalSenderName, updatedAt: Date.now() 
        };

        if (editingMemoId) { await updateDoc(doc(db, "memos", editingMemoId), memoData); } 
        else { memoData.likesCount = 0; memoData.reportCount = 0; memoData.createdAt = Date.now(); await addDoc(collection(db, "memos"), memoData); }
        
        closeMemoForm(); await loadMemosToMap();

        const toast = document.getElementById('materialToast');
        if (toast) { toast.classList.add('show'); setTimeout(() => { toast.classList.remove('show'); }, 3500); }

    } catch (e) { alert("エラーが発生しました"); } finally { saveBtn.disabled = false; saveBtn.textContent = "投稿する"; }
});

async function loadMemosToMap() {
    const q = query(collection(db, "memos"), orderBy("createdAt", "desc")); const snap = await getDocs(q);
    allMemosData = []; latestMemos = []; let count = 0;
    snap.forEach(docSnap => { const data = { id: docSnap.id, ...docSnap.data() }; allMemosData.push(data); if (count < 3) { latestMemos.push(data); count++; } }); applyFilters();
}

function applyFilters() {
    if (!map.getSource('memos')) return;
    const features = []; const usedCoords = []; 
    allMemosData.forEach(data => {
        if (filterState.showMineOnly && data.senderId !== currentUserId) return;
        if (!filterState.categories.includes(data.category)) return;

        const isSelected = data.id === currentOpenMemoId;
        let displayLng = data.lng; let displayLat = data.lat;
        if (!isSelected) {
            let overlapCount = 0; for (let c of usedCoords) { const dist = Math.sqrt(Math.pow(c.lng - displayLng, 2) + Math.pow(c.lat - displayLat, 2)); if (dist < 0.00005) overlapCount++; }
            if (overlapCount > 0) { displayLng += overlapCount * 0.000012; displayLat += overlapCount * 0.000012; }
            usedCoords.push({lng: displayLng, lat: displayLat});
        }
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [displayLng, displayLat] }, properties: { id: data.id, category: data.category, lng: data.lng, lat: data.lat, isSelected: isSelected, opacity: 1.0 } });
    });
    features.sort((a, b) => { if (a.properties.isSelected) return 1; if (b.properties.isSelected) return -1; return 0; });
    map.getSource('memos').setData({ type: 'FeatureCollection', features: features });
}

function showCurrentGroupMemo() {
    if (currentGroupMemos.length === 0) return; const targetMemo = currentGroupMemos[currentGroupIndex]; openMemoBottomSheet(targetMemo);
    const navBar = document.getElementById('memoGroupNav');
    if (navBar) { if (currentGroupMemos.length > 1) { navBar.style.display = 'flex'; document.getElementById('textGroupCount').textContent = `付近に${currentGroupMemos.length}件のメモ (${currentGroupIndex + 1}/${currentGroupMemos.length})`; } else { navBar.style.display = 'none'; } }
}

function openMemoBottomSheet(props) {
    currentOpenMemoId = props.id; applyFilters(); const fullData = allMemosData.find(m => m.id === props.id); if(!fullData) return;

    document.getElementById('sheetCategory').textContent = fullData.category; 
    
    // 🌟 取得した建物名や住所を見やすく結合して表示
    let textContent = "";
    if (fullData.buildingName) textContent += `🏢 ${fullData.buildingName}\n`;
    if (fullData.address) textContent += `📍 ${fullData.address}\n\n`;
    textContent += fullData.text || "";
    document.getElementById('sheetText').textContent = textContent.trim() || "メモがありません";

    const diffMin = Math.floor((Date.now() - fullData.createdAt) / 60000); let timeStr = "たった今";
    if (diffMin >= 60 * 24) timeStr = `${Math.floor(diffMin / (60 * 24))}日前`; else if (diffMin >= 60) timeStr = `${Math.floor(diffMin / 60)}時間前`; else if (diffMin > 0) timeStr = `${diffMin}分前`;
    document.getElementById('sheetTime').textContent = timeStr; document.getElementById('sheetAuthorName').textContent = fullData.senderName; document.getElementById('sheetLikeCount').textContent = fullData.likesCount || 0;
    if (document.getElementById('sheetReportCount')) document.getElementById('sheetReportCount').textContent = fullData.reportCount || 0;

    const manageBtns = document.getElementById('sheetManageButtons'); if (manageBtns) manageBtns.style.display = (fullData.senderId === currentUserId) ? 'flex' : 'none';
    document.getElementById('sheetAuthorContainer').onclick = () => { if (fullData.senderName !== "匿名ドライバー") openProfileModal(fullData.senderId, fullData.senderName); };
    
    const btnNavHere = document.getElementById('btnNavHere');
    if (btnNavHere) { btnNavHere.onclick = () => { window.open(`https://www.google.com/maps/dir/?api=1&destination=${fullData.lat},${fullData.lng}`, '_blank'); }; }

    const imgContainer = document.getElementById('sheetImageContainer'); const scrollArea = document.getElementById('sheetImageScroll'); const dotsArea = document.getElementById('carouselDots'); const counterLabel = document.getElementById('carouselCounter'); let bottomPadding = 300; 
    let images = fullData.imageUrls || (fullData.imageUrl ? [fullData.imageUrl] : []);

    if(images.length > 0) { 
        imgContainer.style.display = 'block'; bottomPadding = 520; scrollArea.innerHTML = ''; dotsArea.innerHTML = '';
        images.forEach((url, idx) => { const img = document.createElement('img'); img.src = url; img.onclick = () => openImageViewer(url); scrollArea.appendChild(img); const dot = document.createElement('div'); dot.className = 'dot' + (idx === 0 ? ' active' : ''); dotsArea.appendChild(dot); });
        if (images.length > 1) { counterLabel.style.display = 'block'; counterLabel.textContent = `1 / ${images.length}`; dotsArea.style.display = 'flex'; scrollArea.onscroll = () => { const index = Math.round(scrollArea.scrollLeft / scrollArea.clientWidth); counterLabel.textContent = `${index + 1} / ${images.length}`; const dots = dotsArea.querySelectorAll('.dot'); dots.forEach((d, i) => { if (i === index) d.classList.add('active'); else d.classList.remove('active'); }); }; } else { counterLabel.style.display = 'none'; dotsArea.style.display = 'none'; }
    } else { imgContainer.style.display = 'none'; }

    map.easeTo({ center: [fullData.lng, fullData.lat], padding: { top: 90, bottom: bottomPadding, left: 0, right: 0 }, duration: 350 });
    document.getElementById('memoActionPanel').classList.remove('show'); document.getElementById('filterBottomSheet').classList.remove('show');
    const sheet = document.getElementById('memoBottomSheet'); sheet.classList.remove('peek'); sheet.classList.add('show');
}

document.getElementById('btnLikeMemo')?.addEventListener('click', async () => { if(!currentOpenMemoId) return; try { await updateDoc(doc(db, "memos", currentOpenMemoId), { likesCount: increment(1) }); const memoSnap = await getDoc(doc(db, "memos", currentOpenMemoId)); if(memoSnap.exists()) { const targetId = memoSnap.data().senderId; await setDoc(doc(db, "profiles", targetId), { totalLikes: increment(1) }, { merge: true }); } document.getElementById('sheetLikeCount').textContent = parseInt(document.getElementById('sheetLikeCount').textContent) + 1; } catch(e) {} });
document.getElementById('btnReportMemo')?.addEventListener('click', async () => { if(!currentOpenMemoId || !confirm("このメモを通報しますか？")) return; try { await updateDoc(doc(db, "memos", currentOpenMemoId), { reportCount: increment(1) }); document.getElementById('sheetReportCount').textContent = parseInt(document.getElementById('sheetReportCount').textContent || 0) + 1; alert("通報しました。ご協力ありがとうございます。"); } catch(e) {} });
document.getElementById('btnDeleteMemo')?.addEventListener('click', async () => { if(!currentOpenMemoId || !confirm("削除しますか？")) return; await deleteDoc(doc(db, "memos", currentOpenMemoId)); document.getElementById('memoBottomSheet').classList.remove('show'); const navBar = document.getElementById('memoGroupNav'); if (navBar) navBar.style.display = 'none'; loadMemosToMap(); });

document.getElementById('btnEditMemo')?.addEventListener('click', () => {
    const memoData = allMemosData.find(m => m.id === currentOpenMemoId); if(!memoData) return;
    editingMemoId = currentOpenMemoId; targetLngLat = { lat: memoData.lat, lng: memoData.lng };
    document.getElementById('memoTextInput').value = memoData.text || "";
    
    // 🌟 編集時に建物名と住所をセット
    document.getElementById('memoBuildingName').value = memoData.buildingName || "";
    document.getElementById('memoAddress').value = memoData.address || "";
    
    const catInputs = document.querySelectorAll('input[name="memoCatInput"]'); 
    catInputs.forEach(input => { 
        if (input.value === memoData.category) { 
            input.checked = true; 
            document.getElementById('buildingInputSection').style.display = input.value === '🏢 建物・入口' ? 'block' : 'none';
        } 
    });

    selectedImageDataUrls = memoData.imageUrls || (memoData.imageUrl ? [memoData.imageUrl] : []);
    if (selectedImageDataUrls.length > 0) { document.getElementById('memoImagePreview').src = selectedImageDataUrls[0]; document.getElementById('memoImagePreviewContainer').style.display = 'block'; let countLabel = document.getElementById('memoImageCountLabel'); if(!countLabel) { countLabel = document.createElement('div'); countLabel.id = 'memoImageCountLabel'; countLabel.style.textAlign = 'center'; countLabel.style.fontSize = '12px'; countLabel.style.color = '#1A73E8'; countLabel.style.fontWeight = 'bold'; countLabel.style.marginTop = '4px'; document.getElementById('memoImagePreviewContainer').appendChild(countLabel); } countLabel.textContent = `${selectedImageDataUrls.length}枚選択中 (最大3枚)`; if (selectedImageDataUrls.length < 3) { document.getElementById('memoCameraBtnText').parentNode.style.display = 'inline-block'; document.getElementById('memoImageBtnText').parentNode.style.display = 'inline-block'; } else { document.getElementById('memoCameraBtnText').parentNode.style.display = 'none'; document.getElementById('memoImageBtnText').parentNode.style.display = 'none'; } } else { document.getElementById('btnRemoveImage').click(); }

    document.getElementById('memoBottomSheet').classList.remove('show'); document.getElementById('memoBottomSheet').classList.remove('peek'); const actionPanel = document.getElementById('memoActionPanel'); actionPanel.classList.remove('peek'); actionPanel.classList.add('show'); 
    
    if (tempPinMarker) { tempPinMarker.remove(); tempPinMarker = null; } 
    const wrapper = document.createElement('div'); wrapper.className = 'marker-wrapper';
    const pin = document.createElement('div'); pin.className = 'sharp-temp-pin pop-animation'; 
    wrapper.appendChild(pin); 
    tempPinMarker = new maplibregl.Marker({ element: wrapper, anchor: 'bottom' }).setLngLat(targetLngLat).addTo(map);
    
    map.flyTo({ center: targetLngLat, padding: { top: 90, bottom: 450, left: 0, right: 0 }, duration: 800 });
});

async function openProfileModal(targetId, targetName) { document.getElementById('modalName').textContent = targetName; document.getElementById('modalArea').textContent = "読込中..."; document.getElementById('modalTime').textContent = "読込中..."; document.getElementById('modalLikesCount').textContent = "-"; document.getElementById('modalTags').innerHTML = ""; document.getElementById('profileModalOverlay').style.display = 'block'; document.getElementById('profileModal').style.display = 'block'; try { const snap = await getDoc(doc(db, "profiles", targetId)); if (snap.exists()) { const data = snap.data(); document.getElementById('modalArea').textContent = data.mainArea || "未設定"; document.getElementById('modalTime').textContent = data.mainTime || "未設定"; document.getElementById('modalLikesCount').textContent = data.totalLikes || 0; const tags = [...(data.vehicles || []), ...(data.services || [])]; if(tags.length) tags.forEach(t => { const span = document.createElement('span'); span.className='tag'; span.textContent=t; document.getElementById('modalTags').appendChild(span); }); } } catch(e) {} }
document.getElementById('closeModalBtn').addEventListener('click', () => { document.getElementById('profileModalOverlay').style.display = 'none'; document.getElementById('profileModal').style.display = 'none'; }); document.getElementById('profileModalOverlay').addEventListener('click', () => { document.getElementById('profileModalOverlay').style.display = 'none'; document.getElementById('profileModal').style.display = 'none'; });
window.openImageViewer = (url) => { document.getElementById('fullSizeImage').src = url; document.getElementById('imageViewerOverlay').style.display = 'block'; document.getElementById('imageViewerModal').style.display = 'block'; }; const closeViewer = () => { document.getElementById('imageViewerOverlay').style.display = 'none'; document.getElementById('imageViewerModal').style.display = 'none'; }; document.getElementById('closeImageViewerBtn').addEventListener('click', closeViewer); document.getElementById('imageViewerOverlay').addEventListener('click', closeViewer);

const btnGroupPrev = document.getElementById('btnGroupPrev'); const btnGroupNext = document.getElementById('btnGroupNext');
if (btnGroupPrev) { btnGroupPrev.addEventListener('click', () => { if (currentGroupIndex > 0) { currentGroupIndex--; showCurrentGroupMemo(); } }); }
if (btnGroupNext) { btnGroupNext.addEventListener('click', () => { if (currentGroupIndex < currentGroupMemos.length - 1) { currentGroupIndex++; showCurrentGroupMemo(); } }); }

const memoSheet = document.getElementById('memoBottomSheet'); let touchStartY = 0;
memoSheet.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
memoSheet.addEventListener('touchend', (e) => { const diff = e.changedTouches[0].clientY - touchStartY; if (diff > 50 && memoSheet.classList.contains('show') && !memoSheet.classList.contains('peek')) { if (memoSheet.scrollTop === 0) memoSheet.classList.add('peek'); } else if (diff < -50 && memoSheet.classList.contains('peek')) { memoSheet.classList.remove('peek'); } });
memoSheet.addEventListener('click', (e) => { if (e.target.id !== 'btnCloseMemoSheet' && !e.target.classList.contains('btn-group-nav') && memoSheet.classList.contains('peek')) { memoSheet.classList.remove('peek'); } });

const btnCloseSheet = document.getElementById('btnCloseMemoSheet');
if (btnCloseSheet) { btnCloseSheet.addEventListener('click', (e) => { e.stopPropagation(); memoSheet.classList.remove('show'); memoSheet.classList.remove('peek'); const navBar = document.getElementById('memoGroupNav'); if (navBar) navBar.style.display = 'none'; currentOpenMemoId = null; applyFilters(); }); }

async function fetchWeatherData(lat, lng, isCustom = false) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,uv_index&timezone=Asia%2FTokyo`;
        const response = await fetch(url); const data = await response.json(); if (!data || !data.current) return;
        const current = data.current;
        const wxMap = { 0: { icon: "☀️", desc: "快晴" }, 1: { icon: "🌤️", desc: "晴れ" }, 2: { icon: "⛅", desc: "晴れ曇り" }, 3: { icon: "☁️", desc: "曇り" }, 45: { icon: "🌫️", desc: "霧" }, 48: { icon: "🌫️", desc: "霧" }, 51: { icon: "🌧️", desc: "霧雨" }, 53: { icon: "🌧️", desc: "霧雨" }, 55: { icon: "🌧️", desc: "霧雨" }, 61: { icon: "☔", desc: "小雨" }, 63: { icon: "☔", desc: "雨" }, 65: { icon: "🌧️", desc: "大雨" }, 71: { icon: "☃️", desc: "軽めの雪" }, 73: { icon: "☃️", desc: "雪" }, 75: { icon: "❄️", desc: "大雪" }, 80: { icon: "🌦️", desc: "にわか雨" }, 81: { icon: "🌦️", desc: "にわか雨" }, 82: { icon: "🌦️", desc: "激しいにわか雨" }, 95: { icon: "⚡", desc: "雷雨" } };
        const wxInfo = wxMap[current.weather_code] || { icon: "📝", desc: "観測中" };
        const getWindDirEmoji = (deg) => { if (deg >= 337.5 || deg < 22.5) return "⬇️ 北風"; if (deg >= 22.5 && deg < 67.5) return "↙️ 北東風"; if (deg >= 67.5 && deg < 112.5) return "⬅️ 東風"; if (deg >= 112.5 && deg < 157.5) return "↖️ 南東風"; if (deg >= 157.5 && deg < 202.5) return "⬆️ 南風"; if (deg >= 202.5 && deg < 247.5) return "↗️ 南西風"; if (deg >= 247.5 && deg < 292.5) return "➡️ 西風"; return "↘️ 北西風"; };
        document.getElementById('wxIcon').textContent = wxInfo.icon; document.getElementById('wxDesc').textContent = wxInfo.desc; document.getElementById('wxTemp').textContent = Math.round(current.temperature_2m); document.getElementById('wxApparentTemp').textContent = Math.round(current.apparent_temperature); document.getElementById('wxHumidity').textContent = current.relative_humidity_2m; document.getElementById('wxWind').textContent = `${Math.round(current.wind_speed_10m)} (${getWindDirEmoji(current.wind_direction_10m)})`; document.getElementById('wxPrecip').textContent = current.precipitation.toFixed(1); document.getElementById('wxUV').textContent = Math.round(current.uv_index); document.getElementById('tickerWeatherSummary').textContent = `${wxInfo.icon} ${Math.round(current.temperature_2m)}℃`;

        let locationName = "現在地周辺";
        if (isCustom) {
            try {
                const geoUrl = `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${MAPTILER_KEY}&language=ja`; const geoRes = await fetch(geoUrl); const geoData = await geoRes.json();
                if (geoData.features && geoData.features.length > 0) { const matchFeature = geoData.features.find(f => f.place_type.includes('municipality') || f.place_type.includes('submunicipality') || f.text.match(/[市区町村]$/)); if (matchFeature) locationName = matchFeature.text; else locationName = geoData.features[0].text; }
            } catch(e) { console.error("地名取得エラー"); }
        }
        document.getElementById('weatherLocationName').textContent = locationName;
    } catch (e) { console.error("天気取得エラー:", e); }
}

const btnWeatherOpen = document.getElementById('weatherClickArea'); const btnWeatherClose = document.getElementById('btnCloseWeather'); const weatherSheet = document.getElementById('weatherBottomSheet'); const btnSelectWeatherArea = document.getElementById('btnSelectWeatherArea'); const weatherTargetMark = document.getElementById('weatherTargetMark'); const btnWeatherConfirm = document.getElementById('btnWeatherConfirm');
if (btnWeatherOpen && weatherSheet) { btnWeatherOpen.addEventListener('click', () => { weatherSheet.classList.add('show'); }); }
if (btnWeatherClose && weatherSheet) { btnWeatherClose.addEventListener('click', () => { weatherSheet.classList.remove('show'); }); }
function closeWeatherSheetOnMapMove() { if (weatherSheet && weatherSheet.classList.contains('show')) { weatherSheet.classList.remove('show'); } }
map.on('dragstart', closeWeatherSheetOnMapMove); map.on('zoomstart', closeWeatherSheetOnMapMove);
if (btnSelectWeatherArea) { btnSelectWeatherArea.addEventListener('click', () => { weatherSheet.classList.remove('show'); weatherTargetMark.style.display = 'block'; btnWeatherConfirm.style.display = 'flex'; }); }
if (btnWeatherConfirm) { btnWeatherConfirm.addEventListener('click', () => { weatherTargetMark.style.display = 'none'; btnWeatherConfirm.style.display = 'none'; const center = map.getCenter(); fetchWeatherData(center.lat, center.lng, true); weatherSheet.classList.add('show'); }); }

document.getElementById('chkRainRadar').addEventListener('change', async (e) => {
    const show = e.target.checked;
    if (show) {
        if (map.getLayer('rain-radar')) { map.setLayoutProperty('rain-radar', 'visibility', 'visible'); return; }
        try {
            const res = await fetch('https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json');
            const data = await res.json();
            const basetime = data[0].basetime;
            const validtime = data[0].validtime;
            map.addSource('jma-radar', { tiles: [`https://www.jma.go.jp/bosai/jmatile/data/nowc/${basetime}/none/${validtime}/surf/hrpns/{z}/{x}/{y}.png`], type: 'raster', tileSize: 256, attribution: '<a href="https://www.jma.go.jp/" target="_blank">気象庁</a>' });
            map.addLayer({ id: 'rain-radar', type: 'raster', source: 'jma-radar', paint: { 'raster-opacity': 0.6 } }, 'clusters'); 
        } catch(err) { alert("雨雲データの取得に失敗しました。"); e.target.checked = false; }
    } else {
        if (map.getLayer('rain-radar')) { map.setLayoutProperty('rain-radar', 'visibility', 'none'); }
    }
});

document.getElementById('btnCheckTraffic').addEventListener('click', () => {
    const center = map.getCenter();
    window.open(`https://www.google.com/maps/@${center.lat},${center.lng},15z/data=!5m1!1e1`, '_blank');
});

document.querySelectorAll('.accordion-header').forEach(button => { button.addEventListener('click', () => { const content = button.nextElementSibling; button.classList.toggle('active'); if (button.classList.contains('active')) { content.style.maxHeight = content.scrollHeight + "px"; } else { content.style.maxHeight = null; } }); });