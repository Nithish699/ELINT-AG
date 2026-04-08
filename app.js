// ═══════════════════════════════════════════
// STATE CONFIGURATION
// ═══════════════════════════════════════════
let map;
let canvas, ctx;
let mode = 'pan'; // pan, radar, emitter, route

let radars = [];       // Known Emitter Library
let emitters = [];     // Unknown Entities
let routeLatLngs = []; // Jet Route Waypoints [L.LatLng]
let pendingLatLng = null; // Stored when modal opens
let editingRadarIdx = null; // Track iteration index when editing
let editingEmitterIdx = null; // Track iteration index when editing/upgrading emitter

let missionRunning = false;
let missionFrame = null;
let missionProgress = 0;
let jetPosLatLng = null;
let jetAngle = 0;
let jetMarker = null;

let collectedSignals = [];
let radarAngles = {}; // Current sweep angle per radar index
let emitterCounter = 1;
let activeDetections = []; // Array of LatLng for drawing active tracking links

// Colors
const GLOW_GREEN = 'rgba(0, 255, 65, 0.8)';
const DIM_GREEN = 'rgba(0, 255, 65, 0.15)';
const AMBER = '#ffaa00';
const CYAN = '#00d4ff';

// ═══════════════════════════════════════════
// INIT LAYER
// ═══════════════════════════════════════════
function init() {
  // Initialize Maplibre GL JS Map focused on India with 3D Terrain
  map = new maplibregl.Map({
    container: 'leaflet-map',
    style: {
      version: 8,
      sources: {
        'satellite': {
          'type': 'raster',
          'tiles': ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          'tileSize': 256
        },
        'terrain-source': {
          'type': 'raster-dem',
          'tiles': ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          'encoding': 'terrarium',
          'tileSize': 256
        }
      },
      layers: [{
        'id': 'satellite-layer',
        'type': 'raster',
        'source': 'satellite',
        'minzoom': 0,
        'maxzoom': 22
      }],
      terrain: { 'source': 'terrain-source', 'exaggeration': 1.5 }
    },
    pitch: 75,
    maxPitch: 85,
    bearing: -20,
    center: [78.9629, 20.5937],
    zoom: 6,
    attributionControl: false
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

  map.on('load', setupMapLayers);

  // Map Click Handling
  map.on('click', onMapClick);
  // Prevent canvas context menu
  map.getContainer().addEventListener('contextmenu', e => {
    e.preventDefault();
    if (mode === 'route') {
      setMode('pan');
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('modal-overlay').classList.contains('show')) closeModal();
      else if (mode === 'route') setMode('pan');
    }
  });

  // Clock
  setInterval(updateClock, 1000);
  updateClock();

  // Splitter Setup
  initSplitter();
}

function initSplitter() {
  const splitter = document.getElementById('panel-splitter');
  let isDragging = false;

  splitter.addEventListener('mousedown', function (e) {
    isDragging = true;
    splitter.classList.add('active');
    document.body.style.cursor = 'ns-resize';
  });

  window.addEventListener('mousemove', function (e) {
    if (!isDragging) return;
    const rightPanelTop = document.getElementById('right-panel').getBoundingClientRect().top;
    const maxH = document.getElementById('right-panel').clientHeight;

    // Calculate new height percentage
    let newHeight = e.clientY - rightPanelTop;
    if (newHeight < 100) newHeight = 100; // min height
    if (newHeight > maxH - 100) newHeight = maxH - 100; // max height

    document.getElementById('panel-top').style.height = `${newHeight}px`;
  });

  window.addEventListener('mouseup', function () {
    isDragging = false;
    splitter.classList.remove('active');
    document.body.style.cursor = 'default';
  });
}

function resizeCanvas() {
  // Empty stub for legacy calls
}

function updateClock() {
  const now = new Date();
  const timeStr = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}Z`;
  document.getElementById('clock').textContent = timeStr;
}

// ═══════════════════════════════════════════
// UI INTERACTIONS
// ═══════════════════════════════════════════
function setMode(newMode) {
  if (missionRunning) return; // Lock modes during mission

  mode = newMode;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));

  const btn = document.getElementById(`btn-${newMode}`);
  if (btn) btn.classList.add('active');

  document.getElementById('mode-display').textContent = newMode.toUpperCase();
  document.getElementById('route-hint').style.display = newMode === 'route' ? 'block' : 'none';

  // Toggle map cursor based on mode
  if (mode === 'pan') {
    map.getContainer().style.cursor = 'grab';
  } else {
    map.getContainer().style.cursor = 'crosshair';
  }
}

function onMapClick(e) {
  const latlng = e.lngLat;

  if (mode === 'radar') {
    pendingLatLng = latlng;
    editingRadarIdx = null;
    showModal();
  } else if (mode === 'emitter') {
    addEmitter(latlng);
  } else if (mode === 'route') {
    routeLatLngs.push(latlng);
    document.getElementById('waypoint-count').textContent = routeLatLngs.length;
    window.needsStaticUpdate = true;
  }
}

// ═══════════════════════════════════════════
// RADAR & EMITTER PLACEMENT
// ═══════════════════════════════════════════
function showModal() {
  document.getElementById('modal-overlay').classList.add('show');

  // Randomize realistic seed values only if it's a new entry
  if (editingRadarIdx === null) {
    randomizeModal();
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('show');
  pendingLatLng = null;
  editingRadarIdx = null;
  editingEmitterIdx = null;
}

function randomizeModal() {
  const prefixes = ['SA', 'S', 'HQ', 'Type', 'JY', 'YJ', 'YLC', 'Relief'];
  const suf = Math.floor(Math.random() * 500) + 1;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const post = chars.charAt(Math.floor(Math.random() * chars.length));

  document.getElementById('f-name').value = `${prefixes[Math.floor(Math.random() * prefixes.length)]}-${suf}${post} VARIANT`;
  document.getElementById('f-freq').value = Math.floor(Math.random() * 4000 + 1000);
  document.getElementById('f-pri').value = Math.floor(Math.random() * 1000 + 500);
  document.getElementById('f-prf').value = Math.floor(1000000 / parseInt(document.getElementById('f-pri').value));
  document.getElementById('f-pw').value = (Math.random() * 8 + 2).toFixed(1);
  document.getElementById('f-range').value = Math.floor(Math.random() * 200 + 50);

  const bands = ["L-Band (1–2 GHz)", "S-Band (2–4 GHz)", "C-Band (4–8 GHz)", "X-Band (8–12 GHz)"];
  document.getElementById('f-band').value = bands[Math.floor(Math.random() * bands.length)];
}

function confirmAddRadar() {
  const name = document.getElementById('f-name').value.trim() || `UNKNOWN SYSTEM - ${radars.length + 1}`;
  const radar = {
    name: name,
    freq: parseFloat(document.getElementById('f-freq').value) || 3000,
    band: document.getElementById('f-band').value,
    pri: parseFloat(document.getElementById('f-pri').value) || 1000,
    prf: parseFloat(document.getElementById('f-prf').value) || 1000,
    pw: parseFloat(document.getElementById('f-pw').value) || 5,
    rangeKm: parseFloat(document.getElementById('f-range').value) || 400,
    bearing: Math.random() * Math.PI * 2
  };

  if (editingRadarIdx !== null) {
    // Editing an existing radar, preserve LatLng and Angle
    radar.latlng = radars[editingRadarIdx].latlng;
    if (radars[editingRadarIdx].bearing !== undefined) radar.bearing = radars[editingRadarIdx].bearing;
    radars[editingRadarIdx] = radar;
    addLog(`EMITTER UPDATED: ${name}`, 'match');
    editingRadarIdx = null;
  } else if (editingEmitterIdx !== null) {
    // Upgrading an Unknown Emitter to a fully characterized Emitter
    radar.latlng = emitters[editingEmitterIdx].latlng;
    radars.push(radar);
    radarAngles[radars.length - 1] = 0;

    const oldId = emitters[editingEmitterIdx].id.toString().padStart(2, '0');
    emitters.splice(editingEmitterIdx, 1);

    addLog(`UNKN-${oldId} IDENTIFIED & CATALOGED AS: ${name}`, 'match');
    editingEmitterIdx = null;
  } else {
    if (!pendingLatLng) return;
    radar.latlng = pendingLatLng;
    radars.push(radar);
    radarAngles[radars.length - 1] = 0;
    addLog(`EMITTER ADDED: ${name} ALIGNED TO DB`, 'match');
  }

  document.getElementById('radar-count').textContent = radars.length;
  document.getElementById('emitter-count').textContent = emitters.length; // Ensure this syncs during upgrades
  updateEmitterLibraryUI();

  closeModal();
  window.needsStaticUpdate = true;
}

function addEmitter(latlng) {
  const e = { latlng, id: emitterCounter++ };
  emitters.push(e);
  document.getElementById('emitter-count').textContent = emitters.length;
  updateEmitterLibraryUI(); // Ensure Emitter Library button counter updates

  const formattedCoord = `${Math.abs(latlng.lat).toFixed(2)}°${latlng.lat > 0 ? 'N' : 'S'}, ${Math.abs(latlng.lng).toFixed(2)}°${latlng.lng > 0 ? 'E' : 'W'}`;
  addLog(`UNKNOWN EMITTER DETECTED AT ${formattedCoord}`, 'unknown');
  window.needsStaticUpdate = true;
}

function clearRoute() {
  routeLatLngs = [];
  document.getElementById('waypoint-count').textContent = '0';
  addLog('WAYPOINTS CLEARED');
  window.needsStaticUpdate = true;
}

// ═══════════════════════════════════════════
// LOG & LIBRARY UI
// ═══════════════════════════════════════════
function addLog(msg, type = 'system') {
  const logDiv = document.getElementById('elint-log');
  const now = new Date();
  const t = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}Z`;

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerText = `[${t}] ${msg}`;

  logDiv.appendChild(entry);
  logDiv.scrollTop = logDiv.scrollHeight;

  // Prune
  if (logDiv.children.length > 200) logDiv.firstChild.remove();
}

function clearLogs() {
  const logDiv = document.getElementById('elint-log');
  logDiv.innerHTML = '<div class="log-entry system">— LOGS CLEARED —</div>';
}

function updateEmitterLibraryUI() {
  const cntSpan = document.getElementById('lib-count');
  if (cntSpan) cntSpan.textContent = `[${radars.length}]`;
}

function openLibrary() {
  const overlay = document.getElementById('library-overlay');
  overlay.style.display = 'flex';
  const tbody = document.getElementById('library-table-body');

  if (radars.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="padding:24px; text-align:center; color:var(--green-dim); font-style:italic;">— NO EMITTERS REGISTERED IN DATABASE —</td></tr>';
    return;
  }

  let htmlRows = "";

  if (radars.length > 0) {
    htmlRows += radars.map((r, i) => `
      <tr style="border-bottom:1px solid rgba(0,255,65,0.1); background:rgba(0,255,65,0.02); transition:all 0.2s;">
        <td style="padding:12px; color:var(--green); font-weight:bold;">${r.name}</td>
        <td style="padding:12px;">${r.freq}</td>
        <td style="padding:12px; color:var(--green-dim);">${r.band.split(' ')[0]}</td>
        <td style="padding:12px;">${r.pri}</td>
        <td style="padding:12px;">${r.prf}</td>
        <td style="padding:12px;">${r.pw}</td>
        <td style="padding:12px; color:var(--cyan);">${r.rangeKm}km</td>
        <td style="padding:12px; text-align:center; min-width:80px;">
          <button class="tool-btn" style="padding:4px 8px; font-size:9px;" onclick="editRadar(${i})">✎</button>
          <button class="tool-btn red" style="padding:4px 8px; font-size:9px;" onclick="deleteRadar(${i})">✕</button>
        </td>
      </tr>
    `).join('');
  }

  tbody.innerHTML = htmlRows;
}

function editRadar(idx) {
  closeLibrary();
  editingRadarIdx = idx;
  const r = radars[idx];

  document.getElementById('modal-overlay').classList.add('show');

  document.getElementById('f-name').value = r.name;
  document.getElementById('f-freq').value = r.freq;
  document.getElementById('f-band').value = r.band;
  document.getElementById('f-pri').value = r.pri;
  document.getElementById('f-prf').value = r.prf;
  document.getElementById('f-pw').value = r.pw;
  document.getElementById('f-range').value = r.rangeKm;
}

function editEmitter(idx) {
  closeLibrary();
  editingEmitterIdx = idx;
  const e = emitters[idx];

  document.getElementById('modal-overlay').classList.add('show');
  randomizeModal();
  document.getElementById('f-name').value = `UNKN-${e.id.toString().padStart(2, '0')} UPGRADE`;
}

function deleteRadar(idx) {
  if (confirm(`Purge Emitter Signature: ${radars[idx].name}?`)) {
    radars.splice(idx, 1);
    updateEmitterLibraryUI();
    openLibrary();
    window.needsStaticUpdate = true;
  }
}

function deleteEmitter(idx) {
  if (confirm(`Purge Unknown Emitter UNKN-${emitters[idx].id.toString().padStart(2, '0')}?`)) {
    emitters.splice(idx, 1);
    updateEmitterLibraryUI();
    openLibrary();
    window.needsStaticUpdate = true;
  }
}

function closeLibrary() {
  document.getElementById('library-overlay').style.display = 'none';
}

// ═══════════════════════════════════════════
// ANIMATION & CANVAS RENDER PIPELINE
// ═══════════════════════════════════════════
// Math approximation for distance natively implementation
function getDistanceKm(ll1, ll2) {
  const R = 6371; // Earth Radius in km
  const dLat = (ll2.lat - ll1.lat) * Math.PI / 180;
  const dLon = (ll2.lng - ll1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(ll1.lat * Math.PI / 180) * Math.cos(ll2.lat * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function getRadiusPx(kmRadius, latlng) {
  const p1 = map.project(latlng);
  const dest = destPointRaw(latlng, 90, kmRadius);
  const p2 = map.project(dest);
  return Math.max(2, Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)));
}

// Math approximation if GeometryUtil is missing
function destPointRaw(latlng, brng, d) {
  const R = 6371; // Earth Radius in km
  const brngRad = brng * Math.PI / 180;
  const lat1 = latlng.lat * Math.PI / 180;
  const lon1 = latlng.lng * Math.PI / 180;

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d / R) +
    Math.cos(lat1) * Math.sin(d / R) * Math.cos(brngRad));
  const lon2 = lon1 + Math.atan2(Math.sin(brngRad) * Math.sin(d / R) * Math.cos(lat1),
    Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2));

  return new maplibregl.LngLat(lon2 * 180 / Math.PI, lat2 * 180 / Math.PI);
}


function createGeoJSONCircle(center, radiusKm, points = 32) {
  const dX = radiusKm / (111.32 * Math.cos(center.lat * Math.PI / 180));
  const dY = radiusKm / 110.574;
  const coords = [];
  for(let i=0; i<points; i++) {
    const th = (i/points)*Math.PI*2;
    coords.push([center.lng + dX*Math.cos(th), center.lat + dY*Math.sin(th)]);
  }
  coords.push(coords[0]);
  return { type:'Feature', geometry: { type:'Polygon', coordinates:[coords] } };
}

function setupMapLayers() {
  const sources = [
    { id: 'route-line', type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    { id: 'route-points', type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    { id: 'radar-rings', type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    { id: 'radar-pulse', type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    { id: 'emitter-pulse', type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    { id: 'active-links', type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
  ];
  sources.forEach(s => map.addSource(s.id, { type: s.type, data: s.data }));

  map.addLayer({ id: 'l-route-line', type: 'line', source: 'route-line', paint: { 'line-color': '#00d4ff', 'line-width': 2, 'line-dasharray': [4, 4] } });
  map.addLayer({ id: 'l-route-points', type: 'circle', source: 'route-points', paint: { 'circle-color': '#00ff41', 'circle-radius': 4 } });
  map.addLayer({ id: 'l-radar-rings', type: 'fill', source: 'radar-rings', paint: { 'fill-color': 'rgba(0, 255, 65, 0.1)', 'fill-outline-color': 'rgba(0, 255, 65, 0.4)' } });
  map.addLayer({ id: 'l-radar-pulse', type: 'line', source: 'radar-pulse', paint: { 'line-color': 'rgba(0, 255, 65, 0.6)', 'line-width': 2 } });
  map.addLayer({ id: 'l-emitter-pulse', type: 'line', source: 'emitter-pulse', paint: { 'line-color': 'rgba(255, 170, 0, 0.6)', 'line-width': 2 } });
  map.addLayer({ id: 'l-active-links', type: 'line', source: 'active-links', paint: { 'line-color': '#00d4ff', 'line-width': 2, 'line-dasharray': [4,4] } });

  requestAnimationFrame(updateMapData);
}

window.needsStaticUpdate = true;
let lastPulseTime = 0;

function setFeatureData(id, data) {
  const source = map.getSource(id);
  if (source) source.setData(data);
}

function updateMapData() {
  if (!map.isStyleLoaded()) {
    requestAnimationFrame(updateMapData);
    return;
  }

  try {
    // 1. Static Elements (Only update when array lengths/stats change)
    if (window.needsStaticUpdate) {
      window.needsStaticUpdate = false;

      // Routes
      if (routeLatLngs.length > 0) {
        const coords = routeLatLngs.map(ll => [ll.lng, ll.lat]);
        if (coords.length > 1) {
          setFeatureData('route-line', { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
        } else {
          setFeatureData('route-line', { type: 'FeatureCollection', features: [] });
        }
        setFeatureData('route-points', { type: 'FeatureCollection', features: coords.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } })) });
      } else {
        setFeatureData('route-line', { type: 'FeatureCollection', features: [] });
        setFeatureData('route-points', { type: 'FeatureCollection', features: [] });
      }

      // Radar Static Rings
      const radarRings = radars.map(r => createGeoJSONCircle(r.latlng, r.rangeKm, 24));
      setFeatureData('radar-rings', { type: 'FeatureCollection', features: radarRings });
    }

    // 2. Throttle Heavy Pulsing Geometries (MapLibre Worker Choke Protection)
    const now = Date.now();
    if (now - lastPulseTime > 50) { // ~20 fps throttled updates for heavy rings
      lastPulseTime = now;
      const t = now / 1000;
      
      const radarPulses = [];
      radars.forEach(r => {
        const pulseSpeed = r.prf ? r.prf / 1000 : 1;
        for (let step = 0; step < 3; step++) {
          const phase = (t * pulseSpeed + step / 3) % 1;
          radarPulses.push(createGeoJSONCircle(r.latlng, r.rangeKm * phase, 24));
        }
      });
      setFeatureData('radar-pulse', { type: 'FeatureCollection', features: radarPulses });

      const emitterPulses = emitters.map(e => {
        const pulseR = (Math.sin(t * 4) + 1) / 2;
        return createGeoJSONCircle(e.latlng, 150 * (0.2 + pulseR * 0.3), 16); // fewer vertices
      });
      setFeatureData('emitter-pulse', { type: 'FeatureCollection', features: emitterPulses });
    }

    // 3. Ultra-Fast Live Simulation Data (60 FPS Safe)
    if (jetPosLatLng) {
      if (!jetMarker) {
        const el = document.createElement('div');
        el.innerHTML = `<svg width="40" height="40" viewBox="-20 -20 40 40" style="overflow: visible;">
          <path d="M 12 0 L 6 3 L 2 3 L -4 12 L -7 12 L -3 3 L -9 2 L -12 6 L -14 6 L -12 0 L -14 -6 L -12 -6 L -9 -2 L -3 -3 L -7 -12 L -4 -12 L 2 -3 L 6 -3 Z" fill="#00d4ff" filter="drop-shadow(0 0 5px #00d4ff)"/>
          <path d="M 8 0 L 5 2 L 2 1 L 2 -1 L 5 -2 Z" fill="rgba(0,0,0,0.7)"/>
        </svg>`;
        el.style.pointerEvents = 'none';
        jetMarker = new maplibregl.Marker({ element: el, pitchAlignment: 'map', rotationAlignment: 'map' })
          .setLngLat(jetPosLatLng)
          .addTo(map);
      }
      jetMarker.setLngLat([jetPosLatLng.lng, jetPosLatLng.lat]);
      jetMarker.setRotation(jetAngle * 180 / Math.PI);

      if (activeDetections.length > 0) {
        const links = activeDetections.map(tg => ({ 
          type: 'Feature', geometry: { type: 'LineString', coordinates: [[jetPosLatLng.lng, jetPosLatLng.lat], [tg.lng, tg.lat]] } 
        }));
        setFeatureData('active-links', { type: 'FeatureCollection', features: links });
      } else {
        setFeatureData('active-links', { type: 'FeatureCollection', features: [] });
      }
    } else {
      if (jetMarker) { jetMarker.remove(); jetMarker = null; }
      setFeatureData('active-links', { type: 'FeatureCollection', features: [] });
    }
  } catch (err) {
    console.error("Map Data Loop Error:", err);
  }

  requestAnimationFrame(updateMapData);
}

function drawCanvas() {
  // Empty stub for legacy calls that triggered synchronous canvas redraws
}

// ═══════════════════════════════════════════
// SORTIE EXECUTION ENGINE
// ═══════════════════════════════════════════

function launchSortie() {
  if (missionRunning) return;
  if (routeLatLngs.length < 2) { addLog('⚠ ERROR: INSUFFICIENT WAYPOINTS', 'alert'); return; }

  setMode('pan'); // Switch mode before setting missionRunning to allow canvas click/drag handling to unlock
  missionRunning = true;
  map.getContainer().style.cursor = 'grab'; // Ensure grab cursor is active

  missionProgress = 0;
  collectedSignals = [];
  activeDetections = [];
  document.getElementById('collected-signals').innerHTML = '';
  document.getElementById('collected-count').textContent = '0';
  document.getElementById('collect-bar').style.width = '0%';

  document.getElementById('btn-launch').style.display = 'none';
  document.getElementById('btn-abort').style.display = 'block';
  setMode('pan'); // Force pan during flight
  map.jumpTo({ center: routeLatLngs[0], zoom: map.getZoom() }); // jump to start

  addLog('▶▶▶ SORTIE AUTHORIZED. RC-135V TAKEOFF.');

  // Build total distance mapping in Km
  const segments = [];
  let totalKm = 0;
  for (let i = 0; i < routeLatLngs.length - 1; i++) {
    const d = getDistanceKm(routeLatLngs[i], routeLatLngs[i + 1]);
    segments.push({ from: routeLatLngs[i], to: routeLatLngs[i + 1], dist: d, cumDist: totalKm });
    totalKm += d;
  }

  let lastTime = null;
  let targetKm = 0;

  const detectedRadars = new Set();
  const detectedEmitters = new Set();
  const COLLECTION_RANGE_KM = 350; // Max intercept range

  function step(ts) {
    if (!missionRunning) return; // Aborted
    if (!lastTime) lastTime = ts;
    const dtSeconds = (ts - lastTime) / 1000.0;
    lastTime = ts;

    const speedVal = document.getElementById('jet-speed') ? parseInt(document.getElementById('jet-speed').value) : 5;
    
    const kmPerSecond = speedVal * 25; // 1 -> 25km/s, 10 -> 250km/s
    targetKm += kmPerSecond * dtSeconds;
    targetKm = Math.min(targetKm, totalKm);

    missionProgress = Math.min(targetKm / totalKm, 1);

    document.getElementById('sortie-progress-fill').style.width = `${missionProgress * 100}%`;
    let currSeg = segments[segments.length - 1];

    for (let i = 0; i < segments.length; i++) {
      if (targetKm <= segments[i].cumDist + segments[i].dist) {
        currSeg = segments[i];
        break;
      }
    }

    const t = currSeg.dist > 0 ? Math.min((targetKm - currSeg.cumDist) / currSeg.dist, 1) : 0;

    // Interpolate LatLng
    const lat = currSeg.from.lat + (currSeg.to.lat - currSeg.from.lat) * t;
    const lng = currSeg.from.lng + (currSeg.to.lng - currSeg.from.lng) * t;
    jetPosLatLng = new maplibregl.LngLat(lng, lat);

    // Calculate Jet Angle (bearing as rads for canvas)
    const pF = map.project(currSeg.from);
    const pT = map.project(currSeg.to);
    jetAngle = Math.atan2(pT.y - pF.y, pT.x - pF.x);

    const jPt = map.project(jetPosLatLng); // Jet current screen coord

    // Intersection Logic: Screen-space pixel map bounds
    radars.forEach((r, i) => {
      if (detectedRadars.has(i)) return;

      const rPt = map.project(r.latlng);
      const rRadiusPx = getRadiusPx(r.rangeKm, r.latlng);
      const cPx = 50; // Jet cone length

      const distPx = Math.sqrt(Math.pow(rPt.x - jPt.x, 2) + Math.pow(rPt.y - jPt.y, 2));

      // 1. MUST overlap on canvas
      if (distPx <= rRadiusPx + cPx) {
        // Since emission is strictly 'Circular', check if the emitter is inside the Jet's forward detection cone
        const angleToTarget = Math.atan2(rPt.y - jPt.y, rPt.x - jPt.x);

        let diff = angleToTarget - jetAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (Math.abs(diff) <= 0.6) {
          detectedRadars.add(i);
          interceptRadar(r);
        }
      }
    });

    emitters.forEach((e, i) => {
      if (detectedEmitters.has(i)) return;

      const ePt = map.project(e.latlng);
      // Unknown emitters have no visible tracking radius on the map.
      // Therefore, the Jet's cone (cPx) must touch the physical point itself.
      const eRadiusPx = 0;
      const cPx = 50;

      const distPx = Math.sqrt(Math.pow(ePt.x - jPt.x, 2) + Math.pow(ePt.y - jPt.y, 2));

      if (distPx <= eRadiusPx + cPx) {
        const angleToTarget = Math.atan2(ePt.y - jPt.y, ePt.x - jPt.x);

        let diff = angleToTarget - jetAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (Math.abs(diff) <= 0.6) {
          detectedEmitters.add(i);
          interceptEmitter(e);
        }
      }
    });

    if (missionProgress < 1) {
      missionFrame = requestAnimationFrame(step);
    } else {
      finishSortie(detectedRadars.size, detectedEmitters.size);
    }
  }

  missionFrame = requestAnimationFrame(step);
}

function interceptRadar(r) {
  const tot = collectedSignals.length + 1;
  collectedSignals.push({ name: r.name, status: 'MATCH' });
  activeDetections.push(r.latlng);

  document.getElementById('collected-count').textContent = tot;
  document.getElementById('collect-bar').style.width = `${Math.min(tot * 10, 100)}%`;

  addLog(`SIGNAL SPIKE DETECTED. ANALYZING MATCH...`, 'system');
  setTimeout(() => {
    addLog(`✓ CONFIRMED: ${r.name} [${r.cat}]`, 'match');
  }, 400);

  appendCollectedUI(r.name, 'KNOWN', r.freq, r.pri);
}

function interceptEmitter(e) {
  const tot = collectedSignals.length + 1;
  collectedSignals.push({ id: e.id, status: 'UNKNOWN' });
  activeDetections.push(e.latlng);

  document.getElementById('collected-count').textContent = tot;
  document.getElementById('collect-bar').style.width = `${Math.min(tot * 10, 100)}%`;

  const freq = Math.floor(Math.random() * 8000 + 2000);
  const pri = Math.floor(Math.random() * 2000 + 500);

  addLog(`⚡ ANOMALOUS SIGNAL [UNKN-${e.id}]`, 'unknown');
  setTimeout(() => {
    addLog(`✕ NO DB MATCH. FLAGGED AS UNKNOWN EMITTER.`, 'alert');
  }, 400);

  appendCollectedUI(`UNKN-${e.id}`, 'UNKNOWN', freq, pri);
}

function appendCollectedUI(title, status, freq, pri) {
  const list = document.getElementById('collected-signals');
  const empty = list.querySelector('.empty-msg');
  if (empty) empty.remove();

  const isK = status === 'KNOWN';
  const cls = isK ? 'card-known' : 'card-unknown';

  const div = document.createElement('div');
  div.className = `emitter-card ${cls}`;
  div.innerHTML = `
    <div class="t-title">${isK ? '✓' : '✕'} ${title} <span class="t-badge">${status}</span></div>
    <div class="t-details">FREQ: ${freq}MHz | PRI: ${pri}μs</div>
  `;
  list.prepend(div);
}

function finishSortie(rCnt, eCnt) {
  missionRunning = false;
  jetPosLatLng = null;
  document.getElementById('btn-abort').style.display = 'none';
  document.getElementById('btn-launch').style.display = 'block';

  addLog(`■■■ SORTIE COMPLETE. RETURNING TO BASE.`, 'system');
  addLog(`>> INTELLIGENCE GATHERED: ${rCnt} KNOWN, ${eCnt} UNKNOWN.`, rCnt > 0 || eCnt > 0 ? 'match' : 'system');
}

function abortSortie() {
  if (missionFrame) cancelAnimationFrame(missionFrame);
  missionRunning = false;
  jetPosLatLng = null;
  document.getElementById('btn-abort').style.display = 'none';
  document.getElementById('btn-launch').style.display = 'block';
  addLog('⚠ SORTIE TERMINATED ABORT SIGNAL RECEIVED', 'alert');
}

function clearAll() {
  abortSortie();
  radars = [];
  emitters = [];
  routeLatLngs = [];
  emitterCounter = 1;
  radarAngles = {};
  collectedSignals = [];
  activeDetections = [];
  jetPosLatLng = null;

  document.getElementById('radar-count').textContent = '0';
  document.getElementById('emitter-count').textContent = '0';
  document.getElementById('waypoint-count').textContent = '0';
  document.getElementById('collected-count').textContent = '0';
  document.getElementById('collect-bar').style.width = '0%';
  document.getElementById('sortie-progress-fill').style.width = '0%';
  document.getElementById('collected-signals').innerHTML = '<div class="empty-msg">— NO SIGNALS ACQUIRED YET —</div>';

  updateEmitterLibraryUI();
  addLog('SYSTEM PURGED. MAP CLEARED.');
  window.needsStaticUpdate = true;
}

// ═══════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════
window.onload = init;
