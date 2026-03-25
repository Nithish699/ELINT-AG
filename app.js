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
let editingRadarIdx = null; // Track iteration index when editing
let editingEmitterIdx = null; // Track iteration index when editing/upgrading emitter

let missionRunning = false;
let missionFrame = null;
let missionProgress = 0;
let jetPosLatLng = null;
let jetAngle = 0;

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

  // Splitter Setup
  initSplitter();

  // Start Background Animation Loop for Sweeps
  requestAnimationFrame(animLoop);
}

function initSplitter() {
  const splitter = document.getElementById('panel-splitter');
  let isDragging = false;
  
  splitter.addEventListener('mousedown', function(e) {
    isDragging = true;
    splitter.classList.add('active');
    document.body.style.cursor = 'ns-resize';
  });
  
  window.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    const rightPanelTop = document.getElementById('right-panel').getBoundingClientRect().top;
    const maxH = document.getElementById('right-panel').clientHeight;
    
    // Calculate new height percentage
    let newHeight = e.clientY - rightPanelTop;
    if (newHeight < 100) newHeight = 100; // min height
    if (newHeight > maxH - 100) newHeight = maxH - 100; // max height
    
    document.getElementById('panel-top').style.height = `${newHeight}px`;
  });
  
  window.addEventListener('mouseup', function() {
    isDragging = false;
    splitter.classList.remove('active');
    document.body.style.cursor = 'default';
  });
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
    editingRadarIdx = null;
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
  const name = document.getElementById('f-name').value.trim() || `UNKNOWN SYSTEM - ${radars.length + 1}`;
  const radar = {
    name: name,
    freq: parseFloat(document.getElementById('f-freq').value) || 3000,
    band: document.getElementById('f-band').value,
    pri: parseFloat(document.getElementById('f-pri').value) || 1000,
    prf: parseFloat(document.getElementById('f-prf').value) || 1000,
    pw: parseFloat(document.getElementById('f-pw').value) || 5,
    scanRate: parseFloat(document.getElementById('f-scan').value) || 12,
    rangeKm: parseFloat(document.getElementById('f-range').value) || 400,
    pattern: document.getElementById('f-pattern').value,
    cat: document.getElementById('f-cat').value,
    bearing: Math.random() * Math.PI * 2
  };

  if (editingRadarIdx !== null) {
    // Editing an existing radar, preserve LatLng and Angle
    radar.latlng = radars[editingRadarIdx].latlng;
    if (radars[editingRadarIdx].bearing !== undefined) radar.bearing = radars[editingRadarIdx].bearing;
    radars[editingRadarIdx] = radar;
    addLog(`RADAR SIGNATURE UPDATED: ${name}`, 'match');
    editingRadarIdx = null;
  } else if (editingEmitterIdx !== null) {
    // Upgrading an Unknown Emitter to a fully characterized Radar Threat
    radar.latlng = emitters[editingEmitterIdx].latlng;
    radars.push(radar);
    radarAngles[radars.length - 1] = 0;
    
    const oldId = emitters[editingEmitterIdx].id.toString().padStart(2,'0');
    emitters.splice(editingEmitterIdx, 1);
    
    addLog(`UNKN-${oldId} IDENTIFIED & CATALOGED AS: ${name}`, 'match');
    editingEmitterIdx = null;
  } else {
    if (!pendingLatLng) return;
    radar.latlng = pendingLatLng;
    radars.push(radar);
    radarAngles[radars.length - 1] = 0;
    addLog(`RADAR ADDED: ${name} ALIGNED TO DB`, 'match');
  }

  document.getElementById('radar-count').textContent = radars.length;
  document.getElementById('emitter-count').textContent = emitters.length; // Ensure this syncs during upgrades
  updateThreatLibraryUI();
  
  closeModal();
  drawCanvas();
}

function addEmitter(latlng) {
  const e = { latlng, id: emitterCounter++ };
  emitters.push(e);
  document.getElementById('emitter-count').textContent = emitters.length;
  updateThreatLibraryUI(); // Ensure Threat Library button counter updates
  
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
  const cntSpan = document.getElementById('lib-count');
  if (cntSpan) cntSpan.textContent = `[${radars.length + emitters.length}]`;
}

function openLibrary() {
  const overlay = document.getElementById('library-overlay');
  overlay.style.display = 'flex';
  const tbody = document.getElementById('library-table-body');
  
  if (radars.length === 0 && emitters.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="padding:24px; text-align:center; color:var(--green-dim); font-style:italic;">— NO THREATS REGISTERED IN DATABASE —</td></tr>';
    return;
  }

  let htmlRows = "";

  if (radars.length > 0) {
    htmlRows += radars.map((r, i) => `
      <tr style="border-bottom:1px solid rgba(0,255,65,0.1); background:rgba(0,255,65,0.02); transition:all 0.2s;">
        <td style="padding:12px; color:var(--green); font-weight:bold;">${r.name}</td>
        <td style="padding:12px; color:var(--green-dim);">${r.cat}</td>
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

  if (emitters.length > 0) {
    htmlRows += emitters.map((e, i) => `
      <tr style="border-bottom:1px solid rgba(255,170,0,0.2); background:rgba(255,170,0,0.05);">
        <td style="padding:12px; color:var(--amber); font-weight:bold;">UNKN-${e.id.toString().padStart(2,'0')}</td>
        <td style="padding:12px; color:var(--amber);">UNCHARACTERIZED</td>
        <td style="padding:12px; color:var(--amber); opacity:0.6;">*VARIES*</td>
        <td style="padding:12px; color:var(--amber); opacity:0.6;">*UNKNOWN*</td>
        <td style="padding:12px; color:var(--amber); opacity:0.6;">*VARIES*</td>
        <td style="padding:12px; color:var(--amber); opacity:0.6;">*VARIES*</td>
        <td style="padding:12px; color:var(--amber); opacity:0.6;">*VARIES*</td>
        <td style="padding:12px; color:var(--amber); opacity:0.6;">*ESTIMATED*</td>
        <td style="padding:12px; text-align:center; min-width:80px;">
          <button class="tool-btn" style="padding:4px 10px; font-size:9px;" onclick="editEmitter(${i})">✎ EDIT</button>
          <button class="tool-btn red" style="padding:4px 8px; font-size:9px;" onclick="deleteEmitter(${i})">✕</button>
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
  document.getElementById('f-scan').value = r.scanRate;
  document.getElementById('f-range').value = r.rangeKm;
  document.getElementById('f-pattern').value = r.pattern;
  document.getElementById('f-cat').value = r.cat;
}

function editEmitter(idx) {
  closeLibrary();
  editingEmitterIdx = idx;
  const e = emitters[idx];
  
  document.getElementById('modal-overlay').classList.add('show');
  randomizeModal(); 
  document.getElementById('f-name').value = `UNKN-${e.id.toString().padStart(2,'0')} UPGRADE`;
}

function deleteRadar(idx) {
  if(confirm(`Purge Threat Signature: ${radars[idx].name}?`)) {
    radars.splice(idx, 1);
    updateThreatLibraryUI();
    openLibrary(); 
    drawCanvas();
  }
}

function deleteEmitter(idx) {
  if(confirm(`Purge Unknown Emitter UNKN-${emitters[idx].id.toString().padStart(2,'0')}?`)) {
    emitters.splice(idx, 1);
    updateThreatLibraryUI();
    openLibrary();
    drawCanvas();
  }
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

  // 5. Draw Active Detection Links
  if (jetPosLatLng && activeDetections.length > 0) {
    const jPt = map.latLngToContainerPoint(jetPosLatLng);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    activeDetections.forEach(ll => {
      const tgPt = map.latLngToContainerPoint(ll);
      ctx.beginPath();
      ctx.moveTo(jPt.x, jPt.y);
      ctx.lineTo(tgPt.x, tgPt.y);
      
      const grad = ctx.createLinearGradient(jPt.x, jPt.y, tgPt.x, tgPt.y);
      grad.addColorStop(0, 'rgba(0, 212, 255, 0.8)');
      grad.addColorStop(1, 'rgba(0, 255, 65, 0)');
      ctx.strokeStyle = grad;
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }
}

function drawRadar(r, idx) {
  const pt = map.latLngToContainerPoint(r.latlng);
  // Don't draw if completely off screen to save perf
  if (pt.x < -1000 || pt.x > canvas.width+1000 || pt.y < -1000 || pt.y > canvas.height+1000) return;

  const radiusPx = getRadiusPx(r.rangeKm, r.latlng);

  // Range Ring / Sector Slice
  ctx.beginPath();
  if (r.pattern === 'Sector') {
    // Draw a pie slice roughly representing the 180 deg frontal sector
    const b = r.bearing || 0;
    ctx.moveTo(pt.x, pt.y);
    ctx.arc(pt.x, pt.y, radiusPx, b - 1.6, b + 1.6);
    ctx.lineTo(pt.x, pt.y);
    
    // Slight fill to show the locked sector zone
    ctx.fillStyle = 'rgba(0, 255, 65, 0.03)';
    ctx.fill();
  } else {
    // Standard full circle
    ctx.arc(pt.x, pt.y, radiusPx, 0, Math.PI * 2);
  }
  
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
  const conePx = 50; // Scaled down for a more realistic medium size
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, conePx, -0.6, 0.6);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 212, 255, 0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Jet Body
  ctx.shadowBlur = 10; ctx.shadowColor = CYAN; ctx.fillStyle = CYAN;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-5, -4);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-5, 4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function animLoop() {
  const t = Date.now() / 1000; // Shared timestamp in seconds

  // Update Sweep angles
  radars.forEach((r, i) => {
    const rpmRadSec = (r.scanRate * Math.PI * 2) / 60;

    if (r.pattern === 'Sector') {
      // Sweeps back and forth through a 120-degree wedge (e.g. fire control tracking)
      const b = r.bearing || 0;
      const sweepSpeed = rpmRadSec; 
      // Swing +/- 1.5 rad around the assigned bearing
      radarAngles[i] = b + Math.sin(t * sweepSpeed) * 1.5; 
    } 
    else if (r.pattern === 'Phased Array (AESA)') {
      // Does not use a rotating physical dish. It electronically jumps the beam instantly.
      // E.g. Patriots and S-400s stare at a sector and rapid-pulse sectors.
      // We will make it randomly jump to a new 0-2PI quadrant every few frames based on scan Rate
      const jumpInterval = Math.max(0.1, 10 / r.scanRate); 
      // Seed random based on timestamp floored to interval
      const seed = Math.floor(t / jumpInterval) + i; 
      // Simple pseudo random hash
      const randomRad = ((seed * 9301 + 49297) % 233280) / 233280; 
      radarAngles[i] = randomRad * Math.PI * 2;
    } 
    else {
      // Default / Circular: Smooth 360 spin
      radarAngles[i] = ((radarAngles[i] || 0) + rpmRadSec * 0.016) % (Math.PI * 2);
    }
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
    const pF = map.latLngToContainerPoint(currSeg.from);
    const pT = map.latLngToContainerPoint(currSeg.to);
    jetAngle = Math.atan2(pT.y - pF.y, pT.x - pF.x);
    
    const jPt = map.latLngToContainerPoint(jetPosLatLng); // Jet current screen coord

    // Intersection Logic: Screen-space pixel map bounds
    radars.forEach((r, i) => {
      if (detectedRadars.has(i)) return;
      
      const rPt = map.latLngToContainerPoint(r.latlng);
      const rRadiusPx = getRadiusPx(r.rangeKm, r.latlng);
      const cPx = 50; // Jet cone length
      
      const distPx = Math.sqrt(Math.pow(rPt.x - jPt.x, 2) + Math.pow(rPt.y - jPt.y, 2));

      // 1. MUST overlap on canvas
      if (distPx <= rRadiusPx + cPx) {
        let isInsideRadarCoverage = true;
        
        // 2. If it's a SECTOR radar, Jet MUST overlap the pie-slice wedge
        if (r.pattern === 'Sector') {
           const angleJetFromRadar = Math.atan2(jPt.y - rPt.y, jPt.x - rPt.x);
           const b = r.bearing || 0;
           let rDiff = angleJetFromRadar - b;
           while (rDiff > Math.PI) rDiff -= Math.PI * 2;
           while (rDiff < -Math.PI) rDiff += Math.PI * 2;
           if (Math.abs(rDiff) > 1.6) {
             isInsideRadarCoverage = false;
           }
        }
        
        if (isInsideRadarCoverage) {
          // 3. Radar MUST be inside the Jet's forward detection cone
          const angleToTarget = Math.atan2(rPt.y - jPt.y, rPt.x - jPt.x);
          
          let diff = angleToTarget - jetAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          
          if (Math.abs(diff) <= 0.6) {
            detectedRadars.add(i);
            interceptRadar(r);
          }
        }
      }
    });

    emitters.forEach((e, i) => {
      if (detectedEmitters.has(i)) return;
      
      const ePt = map.latLngToContainerPoint(e.latlng);
      const eRadiusPx = getRadiusPx(150, e.latlng); // Unknown emitters estimated at 150km range
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
  activeDetections = [];
  
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
