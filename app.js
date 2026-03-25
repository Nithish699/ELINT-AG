// ═══════════════════════════════════════════
// STATE CONFIGURATION
// ═══════════════════════════════════════════
let map;
let canvas, ctx;
let mode = 'pan'; // pan, radar, emitter, route

let radars = [];       // Known Threat Library
let emitters = [];     // Unknown Entities
let routeLatLngs = []; // Jet Route Waypoints [L.LatLng]
let pendingLatLng = null; // Stored when modal opens

let missionRunning = false;
let missionFrame = null;
let missionProgress = 0;
let jetPosLatLng = null;
let jetAngle = 0;

let collectedSignals = [];
let radarAngles = {}; // Current sweep angle per radar index
let emitterCounter = 1;

// Colors
const GLOW_GREEN = 'rgba(0, 255, 65, 0.8)';
const DIM_GREEN = 'rgba(0, 255, 65, 0.15)';
const AMBER = '#ffaa00';
const CYAN = '#00d4ff';

// ═══════════════════════════════════════════
// INIT LAYER
// ═══════════════════════════════════════════
function init() {
  // Initialize Leaflet Map focused on India
  map = L.map('leaflet-map', {
    center: [20.5937, 78.9629],
    zoom: 5,
    zoomControl: false,
    attributionControl: false
  });

  // Use CartoDB Dark Matter for the "Realistic World Map" in dark tactical mode
  const baseTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19
  }).addTo(map);

  canvas = document.getElementById('overlay-canvas');
  ctx = canvas.getContext('2d');

  // Resize handling
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Redraw canvas explicitly when map moves or zooms
  map.on('move', drawCanvas);
  map.on('zoom', drawCanvas);

  // Map Click Handling
  map.on('click', onMapClick);
  // Prevent leaflet context menu
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

  // Start Background Animation Loop for Sweeps
  requestAnimationFrame(animLoop);
}

function resizeCanvas() {
  const container = document.getElementById('view-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  drawCanvas();
}

function updateClock() {
  const now = new Date();
  const timeStr = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}:${String(now.getUTCSeconds()).padStart(2,'0')}Z`;
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

  // Toggle map dragging based on mode
  if (mode === 'pan') {
    map.dragging.enable();
    map.getContainer().style.cursor = 'grab';
  } else {
    map.dragging.disable();
    map.getContainer().style.cursor = 'crosshair';
  }
}

function onMapClick(e) {
  const latlng = e.latlng;

  if (mode === 'radar') {
    pendingLatLng = latlng;
    showModal();
  } else if (mode === 'emitter') {
    addEmitter(latlng);
  } else if (mode === 'route') {
    routeLatLngs.push(latlng);
    document.getElementById('waypoint-count').textContent = routeLatLngs.length;
    drawCanvas();
  }
}

// ═══════════════════════════════════════════
// RADAR & EMITTER PLACEMENT
// ═══════════════════════════════════════════
function showModal() {
  document.getElementById('modal-overlay').classList.add('show');
  
  // Randomize realistic seed values
  document.getElementById('f-name').value = '';
  document.getElementById('f-freq').value = Math.floor(Math.random() * 4000 + 1000);
  document.getElementById('f-pri').value = Math.floor(Math.random() * 1000 + 500);
  document.getElementById('f-prf').value = Math.floor(1000000 / parseInt(document.getElementById('f-pri').value));
  document.getElementById('f-pw').value = (Math.random() * 8 + 2).toFixed(1);
  document.getElementById('f-scan').value = Math.floor(Math.random() * 15 + 5);
  document.getElementById('f-range').value = Math.floor(Math.random() * 300 + 100);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('show');
  pendingLatLng = null;
}

function randomizeModal() {
  const prefixes = ['SA', 'S', 'HQ', 'Type', 'JY', 'YJ', 'YLC', 'Relief'];
  const suf = Math.floor(Math.random() * 500) + 1;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const post = chars.charAt(Math.floor(Math.random() * chars.length));

  document.getElementById('f-name').value = `${prefixes[Math.floor(Math.random()*prefixes.length)]}-${suf}${post} VARIANT`;
  document.getElementById('f-freq').value = Math.floor(Math.random() * 4000 + 1000);
  document.getElementById('f-pri').value = Math.floor(Math.random() * 1000 + 500);
  document.getElementById('f-prf').value = Math.floor(1000000 / parseInt(document.getElementById('f-pri').value));
  document.getElementById('f-pw').value = (Math.random() * 8 + 2).toFixed(1);
  document.getElementById('f-scan').value = Math.floor(Math.random() * 15 + 5);
  document.getElementById('f-range').value = Math.floor(Math.random() * 300 + 100);
  
  const bands = ["L-Band (1–2 GHz)","S-Band (2–4 GHz)","C-Band (4–8 GHz)","X-Band (8–12 GHz)"];
  document.getElementById('f-band').value = bands[Math.floor(Math.random()*bands.length)];
}

function confirmAddRadar() {
  if (!pendingLatLng) return;

  const name = document.getElementById('f-name').value.trim() || `UNKNOWN SYSTEM - ${radars.length + 1}`;
  const radar = {
    latlng: pendingLatLng,
    name: name,
    freq: parseFloat(document.getElementById('f-freq').value) || 3000,
    band: document.getElementById('f-band').value,
    pri: parseFloat(document.getElementById('f-pri').value) || 1000,
    prf: parseFloat(document.getElementById('f-prf').value) || 1000,
    pw: parseFloat(document.getElementById('f-pw').value) || 5,
    scanRate: parseFloat(document.getElementById('f-scan').value) || 12,
    rangeKm: parseFloat(document.getElementById('f-range').value) || 400,
    pattern: document.getElementById('f-pattern').value,
    cat: document.getElementById('f-cat').value
  };

  radars.push(radar);
  radarAngles[radars.length - 1] = 0;

  document.getElementById('radar-count').textContent = radars.length;
  updateThreatLibraryUI();
  addLog(`RADAR ADDED: ${name} ALIGNED TO DB`, 'match');
  
  closeModal();
  drawCanvas();
}

function addEmitter(latlng) {
  const e = { latlng, id: emitterCounter++ };
  emitters.push(e);
  document.getElementById('emitter-count').textContent = emitters.length;
  
  const formattedCoord = `${Math.abs(latlng.lat).toFixed(2)}°${latlng.lat>0?'N':'S'}, ${Math.abs(latlng.lng).toFixed(2)}°${latlng.lng>0?'E':'W'}`;
  addLog(`UNKNOWN EMITTER DETECTED AT ${formattedCoord}`, 'unknown');
  drawCanvas();
}

function clearRoute() {
  routeLatLngs = [];
  document.getElementById('waypoint-count').textContent = '0';
  addLog('WAYPOINTS CLEARED');
  drawCanvas();
}

// ═══════════════════════════════════════════
// LOG & LIBRARY UI
// ═══════════════════════════════════════════
function addLog(msg, type = 'system') {
  const logDiv = document.getElementById('elint-log');
  const now = new Date();
  const t = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}:${String(now.getUTCSeconds()).padStart(2,'0')}Z`;
  
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

function updateThreatLibraryUI() {
  const list = document.getElementById('threat-list');
  document.getElementById('lib-count').textContent = `[${radars.length}]`;
  
  if (radars.length === 0) {
    list.innerHTML = '<div class="empty-msg">— LIBRARY EMPTY —</div>';
    return;
  }

  list.innerHTML = radars.map(r => `
    <div class="threat-card card-known">
      <div class="t-title">◈ ${r.name}</div>
      <div class="t-details">
        > TYPE: ${r.cat} | BAND: ${r.band.split(' ')[0]}<br>
        > RANGE: ${r.rangeKm}km | PATTERN: ${r.pattern}<br>
        > FREQ: ${r.freq}MHz | PRI: ${r.pri}μs
      </div>
    </div>
  `).join('');
}

function openLibrary() {
  const overlay = document.getElementById('library-overlay');
  overlay.style.display = 'flex';
  const tbody = document.getElementById('library-table-body');
  
  if (radars.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:24px; text-align:center; color:var(--green-dim); font-style:italic;">— NO THREATS REGISTERED IN DATABASE —</td></tr>';
    return;
  }

  tbody.innerHTML = radars.map(r => `
    <tr style="border-bottom:1px solid rgba(0,255,65,0.1); background:rgba(0,255,65,0.02); transition:all 0.2s;">
      <td style="padding:12px; color:var(--green); font-weight:bold;">${r.name}</td>
      <td style="padding:12px; color:var(--green-dim);">${r.cat}</td>
      <td style="padding:12px;">${r.freq}</td>
      <td style="padding:12px; color:var(--green-dim);">${r.band.split(' ')[0]}</td>
      <td style="padding:12px;">${r.pri}</td>
      <td style="padding:12px;">${r.prf}</td>
      <td style="padding:12px;">${r.pw}</td>
      <td style="padding:12px; color:var(--cyan);">${r.rangeKm}km</td>
    </tr>
  `).join('');
}

function closeLibrary() {
  document.getElementById('library-overlay').style.display = 'none';
}

// ═══════════════════════════════════════════
// ANIMATION & CANVAS RENDER PIPELINE
// ═══════════════════════════════════════════
// meters per pixel approx at equator: 40075016 / 256 / 2^zoom * Math.cos(lat)
// Better: We just use leafet point conversion, and for radius we can convert LatLng to Point at Map center
function getRadiusPx(kmRadius, latlng) {
  const p1 = map.latLngToContainerPoint(latlng);
  
  // Calculate a point 'radius' km East
  const dest = L.GeometryUtil ? 
    L.GeometryUtil.destination(latlng, 90, kmRadius * 1000) : 
    destPointRaw(latlng, 90, kmRadius);
    
  const p2 = map.latLngToContainerPoint(dest);
  return Math.max(2, Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)));
}

// Math approximation if GeometryUtil is missing
function destPointRaw(latlng, brng, d) {
    const R = 6371; // Earth Radius in km
    const brngRad = brng * Math.PI / 180;
    const lat1 = latlng.lat * Math.PI / 180;
    const lon1 = latlng.lng * Math.PI / 180;

    const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d/R) + 
                         Math.cos(lat1)*Math.sin(d/R)*Math.cos(brngRad));
    const lon2 = lon1 + Math.atan2(Math.sin(brngRad)*Math.sin(d/R)*Math.cos(lat1), 
                                 Math.cos(d/R)-Math.sin(lat1)*Math.sin(lat2));

    return L.latLng(lat2 * 180 / Math.PI, lon2 * 180 / Math.PI);
}


function drawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Draw Route
  if (routeLatLngs.length > 0) {
    ctx.beginPath();
    const pts = routeLatLngs.map(ll => map.latLngToContainerPoint(ll));
    ctx.moveTo(pts[0].x, pts[0].y);
    for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Waypoints
    pts.forEach((pt, i) => {
      ctx.fillStyle = i===0 ? '#00ff41' : (i===pts.length-1 ? '#ff2a2a' : '#00d4ff');
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI*2); ctx.fill();
    });
  }

  // 2. Draw Known Radars
  radars.forEach((r, i) => drawRadar(r, i));

  // 3. Draw Unknown Emitters
  emitters.forEach(e => drawEmitter(e));

  // 4. Draw Jet
  if (jetPosLatLng) drawJet();
}

function drawRadar(r, idx) {
  const pt = map.latLngToContainerPoint(r.latlng);
  // Don't draw if completely off screen to save perf
  if (pt.x < -1000 || pt.x > canvas.width+1000 || pt.y < -1000 || pt.y > canvas.height+1000) return;

  const radiusPx = getRadiusPx(r.rangeKm, r.latlng);

  // Range Ring
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, radiusPx, 0, Math.PI * 2);
  ctx.strokeStyle = DIM_GREEN;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Sweep Cone
  const angle = radarAngles[idx] || 0;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pt.x, pt.y);
  ctx.arc(pt.x, pt.y, radiusPx, angle, angle + 0.3); // Beam width
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 255, 65, 0.08)';
  ctx.fill();

  // Sweep Line
  ctx.beginPath();
  ctx.moveTo(pt.x, pt.y);
  ctx.lineTo(pt.x + Math.cos(angle) * radiusPx, pt.y + Math.sin(angle) * radiusPx);
  ctx.strokeStyle = GLOW_GREEN;
  ctx.stroke();

  // Icon
  ctx.fillStyle = '#00ff41';
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#00ff41';
  ctx.fillRect(pt.x-3, pt.y-3, 6, 6);
  ctx.restore();

  // Label
  ctx.fillStyle = '#00ff41';
  ctx.font = '10px "Share Tech Mono"';
  ctx.fillText(r.name, pt.x + 8, pt.y);
  ctx.fillStyle = 'rgba(0,255,65,0.6)';
  ctx.fillText(r.band.split(' ')[0], pt.x + 8, pt.y + 12);
}

function drawEmitter(e) {
  const pt = map.latLngToContainerPoint(e.latlng);
  if (pt.x < -100 || pt.x > canvas.width+100 || pt.y < -100 || pt.y > canvas.height+100) return;

  // Pulse effect based on time
  const t = Date.now() / 1000;
  const pulseR = (Math.sin(t * 4) + 1) / 2;
  const radiusPx = getRadiusPx(150, e.latlng); // hardcoded estimate range

  ctx.beginPath();
  ctx.arc(pt.x, pt.y, radiusPx * (0.2 + pulseR * 0.3), 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 170, 0, ${0.1 + pulseR * 0.1})`;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Diamond shape
  ctx.save();
  ctx.shadowBlur = 15;
  ctx.shadowColor = AMBER;
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(pt.x, pt.y - 6);
  ctx.lineTo(pt.x + 6, pt.y);
  ctx.lineTo(pt.x, pt.y + 6);
  ctx.lineTo(pt.x - 6, pt.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Label
  ctx.fillStyle = AMBER;
  ctx.font = '10px "Share Tech Mono"';
  ctx.fillText(`UNKN-${String(e.id).padStart(2,'0')}`, pt.x + 10, pt.y);
}

function drawJet() {
  const pt = map.latLngToContainerPoint(jetPosLatLng);
  
  ctx.save();
  ctx.translate(pt.x, pt.y);
  ctx.rotate(jetAngle); // Use simple screen angle (radians)

  // Sensor Collection Cone (spread facing forward)
  const conePx = 60; // Reduced size for cleaner UI
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, conePx, -0.4, 0.4);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 212, 255, 0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Jet Body
  ctx.shadowBlur = 15; ctx.shadowColor = CYAN; ctx.fillStyle = CYAN;
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-8, -6);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-8, 6);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function animLoop() {
  // Update Sweep angles
  radars.forEach((r, i) => {
    // scanRate is RPM. rad/sec = scanRate * 2PI / 60
    // roughly 16ms per frame -> angle delta = (rad/sec) * 0.016
    const rpmRadSec = (r.scanRate * Math.PI * 2) / 60;
    radarAngles[i] = ((radarAngles[i] || 0) + rpmRadSec * 0.016) % (Math.PI * 2);
  });

  drawCanvas();
  requestAnimationFrame(animLoop);
}

// ═══════════════════════════════════════════
// SORTIE EXECUTION ENGINE
// ═══════════════════════════════════════════

function launchSortie() {
  if (missionRunning) return;
  if (routeLatLngs.length < 2) { addLog('⚠ ERROR: INSUFFICIENT WAYPOINTS', 'alert'); return; }
  
  missionRunning = true;
  missionProgress = 0;
  collectedSignals = [];
  document.getElementById('collected-signals').innerHTML = '';
  document.getElementById('collected-count').textContent = '0';
  document.getElementById('collect-bar').style.width = '0%';
  
  document.getElementById('btn-launch').style.display = 'none';
  document.getElementById('btn-abort').style.display = 'block';
  setMode('pan'); // Force pan during flight
  map.setView(routeLatLngs[0], map.getZoom()); // jump to start

  addLog('▶▶▶ SORTIE AUTHORIZED. RC-135V TAKEOFF.');
  
  // Build total distance mapping in Km
  const segments = [];
  let totalKm = 0;
  for(let i=0; i<routeLatLngs.length-1; i++) {
    const d = routeLatLngs[i].distanceTo(routeLatLngs[i+1]) / 1000; // Leaflet distance is meters
    segments.push({from: routeLatLngs[i], to: routeLatLngs[i+1], dist: d, cumDist: totalKm});
    totalKm += d;
  }

  const durationMs = 25000; // 25s flight
  let startTime = null;

  const detectedRadars = new Set();
  const detectedEmitters = new Set();
  const COLLECTION_RANGE_KM = 350; // Max intercept range

  function step(ts) {
    if (!missionRunning) return; // Aborted
    if (!startTime) startTime = ts;
    
    const elapsed = ts - startTime;
    missionProgress = Math.min(elapsed / durationMs, 1);
    
    document.getElementById('sortie-progress-fill').style.width = `${missionProgress * 100}%`;

    const targetKm = missionProgress * totalKm;
    let currSeg = segments[segments.length-1];
    
    for(let i=0; i<segments.length; i++) {
      if (targetKm <= segments[i].cumDist + segments[i].dist) {
        currSeg = segments[i];
        break;
      }
    }

    const t = currSeg.dist > 0 ? Math.min((targetKm - currSeg.cumDist) / currSeg.dist, 1) : 0;
    
    // Interpolate LatLng
    const lat = currSeg.from.lat + (currSeg.to.lat - currSeg.from.lat) * t;
    const lng = currSeg.from.lng + (currSeg.to.lng - currSeg.from.lng) * t;
    jetPosLatLng = L.latLng(lat, lng);

    // Calculate Jet Angle (bearing as rads for canvas)
    // Map screen projection:
    const pF = map.latLngToContainerPoint(currSeg.from);
    const pT = map.latLngToContainerPoint(currSeg.to);
    jetAngle = Math.atan2(pT.y - pF.y, pT.x - pF.x);

    // Optionally pan map slowly with jet
    // map.panTo(jetPosLatLng, {animate: true, duration: 0.2});

    // Intersection Logic
    radars.forEach((r, i) => {
      if (detectedRadars.has(i)) return;
      if (jetPosLatLng.distanceTo(r.latlng)/1000 < COLLECTION_RANGE_KM) {
        detectedRadars.add(i);
        interceptRadar(r);
      }
    });

    emitters.forEach((e, i) => {
      if (detectedEmitters.has(i)) return;
      if (jetPosLatLng.distanceTo(e.latlng)/1000 < COLLECTION_RANGE_KM) {
        detectedEmitters.add(i);
        interceptEmitter(e);
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
  
  document.getElementById('collected-count').textContent = tot;
  document.getElementById('collect-bar').style.width = `${Math.min(tot * 10, 100)}%`;

  const freq = Math.floor(Math.random() * 8000 + 2000);
  const pri = Math.floor(Math.random() * 2000 + 500);

  addLog(`⚡ ANOMALOUS SIGNAL [UNKN-${e.id}]`, 'unknown');
  setTimeout(() => {
    addLog(`✕ NO DB MATCH. FLAGGED AS NEW THREAT.`, 'alert');
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
  div.className = `threat-card ${cls}`;
  div.innerHTML = `
    <div class="t-title">${isK?'✓':'✕'} ${title} <span class="t-badge">${status}</span></div>
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
  addLog(`>> INTELLIGENCE GATHERED: ${rCnt} KNOWN, ${eCnt} UNKNOWN.`, rCnt>0||eCnt>0 ? 'match':'system');
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
  
  document.getElementById('radar-count').textContent = '0';
  document.getElementById('emitter-count').textContent = '0';
  document.getElementById('waypoint-count').textContent = '0';
  document.getElementById('collected-count').textContent = '0';
  document.getElementById('collect-bar').style.width = '0%';
  document.getElementById('sortie-progress-fill').style.width = '0%';
  document.getElementById('collected-signals').innerHTML = '<div class="empty-msg">— NO SIGNALS ACQUIRED YET —</div>';
  
  updateThreatLibraryUI();
  addLog('SYSTEM PURGED. MAP CLEARED.');
  drawCanvas();
}

// ═══════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════
window.onload = init;
