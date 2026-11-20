// BMEN 220 — browser wrist-assessment prototype.
// Experimental 2D landmark measurement, NOT a medical device.
import { FilesetResolver, HolisticLandmarker } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/+esm';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task';
const STORAGE_KEY = 'bmen220-wrist-assessments-v1';
const SETTINGS = Object.freeze({
  neutralTolerance: 3,
  directionThreshold: 10,
  maxReasonableAngle: 100,
  maxFrameChange: 30,
  minVisibility: .5,
  smoothingWindow: 5,
  stableWindow: 7,
  stableTolerance: 5
});

const $ = (id) => document.getElementById(id);
const ui = {
  video: $('video'), overlay: $('overlay'), placeholder: $('cameraPlaceholder'),
  cameraBadge: $('cameraBadge'), status: $('status'), hand: $('handSelect'),
  start: $('startCamera'), stop: $('stopCamera'), calibrate: $('calibrate'),
  flexion: $('setFlexion'), record: $('record'), recordBadge: $('recordBadge'),
  movement: $('movement'), angle: $('currentAngle'), maxFlexion: $('maxFlexion'),
  maxExtension: $('maxExtension'), neutralStatus: $('neutralStatus'),
  flexStatus: $('flexStatus'), stabilityStatus: $('stabilityStatus'),
  body: $('historyBody'), count: $('recordCount'), export: $('exportCsv'),
  clear: $('clearHistory'), landmarkStatus: $('landmarkStatus')
};
let landmarker = null, stream = null, rafId = null, lastVideoTime = -1;
let calibration = null, flexionDirection = null, currentRaw = null, currentDelta = null;
let hand = 'Right', recording = false, maxFlexion = 0, maxExtension = 0;
let acceptedFlexion = 0, acceptedExtension = 0, lastMovement = null;
let smoother = [], stable = [], lastSeenFrameAt = 0;
let cameraStarting = false;

function setStatus(message) { ui.status.textContent = message; }
function median(values) {
  const s = [...values].sort((a,b) => a-b);
  const middle = Math.floor(s.length / 2);
  return s.length % 2 ? s[middle] : (s[middle-1] + s[middle]) / 2;
}
function normalizedAngle(degrees) { return ((degrees + 180) % 360 + 360) % 360 - 180; }
function angleAtWrist(elbow, wrist, knuckle) {
  const a = {x: elbow.x-wrist.x, y: elbow.y-wrist.y};
  const b = {x: knuckle.x-wrist.x, y: knuckle.y-wrist.y};
  const cross = a.x*b.y-a.y*b.x;
  const dot = a.x*b.x+a.y*b.y;
  if (Math.hypot(a.x,a.y)<.025 || Math.hypot(b.x,b.y)<.025) return null;
  return Math.atan2(cross,dot)*180/Math.PI;
}
function resetFilters() { smoother=[]; stable=[]; lastMovement=null; }
function resetRecordingData() {
  maxFlexion=0; maxExtension=0; acceptedFlexion=0; acceptedExtension=0;
  resetFilters(); updateNumbers();
}
function updateNumbers() {
  ui.maxFlexion.textContent=`${maxFlexion.toFixed(1)}°`;
  ui.maxExtension.textContent=`${maxExtension.toFixed(1)}°`;
}
function updateButtons() {
  const ready = Boolean(stream && landmarker);
  ui.start.disabled=Boolean(stream) || cameraStarting;
  ui.stop.disabled=!stream;
  ui.hand.disabled=recording;
  ui.calibrate.disabled=!ready || recording || currentRaw===null;
  ui.flexion.disabled=!ready || recording || calibration===null || currentDelta===null;
  ui.record.disabled=!ready || (!recording && (calibration===null || flexionDirection===null));
  ui.record.textContent=recording?'Stop & save assessment':'Start assessment';
  ui.recordBadge.textContent=recording?'● Recording':'Not recording';
  ui.recordBadge.classList.toggle('recording',recording);
  ui.cameraBadge.textContent=ready?'Camera on':cameraStarting?'Starting camera…':'Camera off';
}
async function loadLandmarker() {
  if (landmarker) return;
  setStatus('Downloading MediaPipe and model; first load can take a little longer…');
  const vision=await FilesetResolver.forVisionTasks(WASM_BASE);
  // CPU delegation is broadly supported; GPU may vary by platform.
  landmarker=await HolisticLandmarker.createFromOptions(vision, {
    baseOptions: {modelAssetPath: MODEL_URL, delegate:'CPU'},
    runningMode:'VIDEO',
    minPoseDetectionConfidence:.5,
    minHandLandmarksConfidence:.5
  });
}

async function startCamera() {
  if (cameraStarting || stream) return;
  cameraStarting=true; updateButtons();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS or localhost and a supported browser.');
    // Request permission from an explicit click. Video stays on this device.
    stream=await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:'user',width:{ideal:640},height:{ideal:480}}});
    ui.video.srcObject=stream;
    await ui.video.play();
    await loadLandmarker();
    ui.placeholder.hidden=true;
    ui.placeholder.style.display='none';
    lastVideoTime=-1;
    setStatus('Camera ready. Keep wrist, elbow, and hand in view; select the wrist you want to assess.');
    rafId=requestAnimationFrame(frameLoop);
  } catch (error) {
    console.error(error);
    stopCamera();
    setStatus(`Camera could not start: ${error.message || String(error)}. Check permission, HTTPS, and internet access.`);
  } finally {cameraStarting=false;updateButtons();}
}
function stopCamera() {
  if (rafId!==null) cancelAnimationFrame(rafId);
  rafId=null;
  if (stream) stream.getTracks().forEach(track=>track.stop());
  stream=null; ui.video.srcObject=null; ui.placeholder.hidden=false;
  ui.placeholder.style.display='flex';
  calibration=null; flexionDirection=null; currentRaw=null; currentDelta=null;
  recording=false; resetRecordingData();
  ui.neutralStatus.textContent='Not set'; ui.flexStatus.textContent='Not set';
  ui.stabilityStatus.textContent='Waiting'; ui.landmarkStatus.textContent='Waiting for camera'; ui.angle.textContent='—';
  ui.movement.textContent='—'; ui.overlay.getContext('2d').clearRect(0,0,ui.overlay.width,ui.overlay.height);
  updateButtons();
}
function drawSegment(ctx, a, b, color, w, h) {
  ctx.strokeStyle=color;ctx.lineWidth=4;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(a.x*w,a.y*h);ctx.lineTo(b.x*w,b.y*h);ctx.stroke();
  ctx.fillStyle=color;
  for (const p of [a,b]) {ctx.beginPath();ctx.arc(p.x*w,p.y*h,5,0,Math.PI*2);ctx.fill();}
}
function handleInvalid(message) {
  currentRaw=null;currentDelta=null;resetFilters();
  ui.angle.textContent='—';ui.movement.textContent='—';
  ui.stabilityStatus.textContent='Tracking unavailable';
  setStatus(message);
}
function processResult(result) {
  // MediaPipe Web HolisticLandmarker returns arrays OF landmark sets.
  // First set is the detected person/hand, then landmark indices (14/16/9).
  // Python's HolisticLandmarker uses different result nesting.
  const pose=result.poseLandmarks?.[0] ?? [];
  const hands=(hand==='Right'
    ? result.rightHandLandmarks?.[0]
    : result.leftHandLandmarks?.[0]) ?? [];
  ui.landmarkStatus.textContent =
    `Pose: ${pose.length}/33 · ${hand} hand: ${hands.length}/21`;
  const elIdx=hand==='Right'?14:13;
  const wrIdx=hand==='Right'?16:15;
  const elbow=pose?.[elIdx], wrist=pose?.[wrIdx], knuckle=hands?.[9];
  const canvas=ui.overlay;
  const width=ui.video.videoWidth, height=ui.video.videoHeight;
  if (width && height && (canvas.width!==width || canvas.height!==height)) {
    canvas.width=width;canvas.height=height;
  }
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  if (!elbow || !wrist || !knuckle || (elbow.visibility??1)<SETTINGS.minVisibility || (wrist.visibility??1)<SETTINGS.minVisibility) {
    handleInvalid(`Show your ${hand.toLowerCase()} elbow, wrist and hand in a clear side view.`);
    return;
  }
  drawSegment(ctx,elbow,wrist,'#52e39f',width,height);
  drawSegment(ctx,wrist,knuckle,'#5fb0ff',width,height);
  const raw=angleAtWrist(elbow,wrist,knuckle);
  if (raw===null) {handleInvalid('Move farther from the camera so the forearm and hand are visible.');return;}
  currentRaw=raw;
  if (calibration===null) {
    currentDelta=null;ui.neutralStatus.textContent='Not set';
    setStatus('Tracking detected. Hold wrist straight, then choose “Calibrate neutral”.');
    return;
  }
  currentDelta=normalizedAngle(raw-calibration);
  if (flexionDirection===null) {
    setStatus('Neutral set. Bend wrist toward your palm and choose “Identify flexion”.');
    return;
  }
  const measured=currentDelta*flexionDirection;
  if (Math.abs(measured)>SETTINGS.maxReasonableAngle || (lastMovement!==null && Math.abs(measured-lastMovement)>SETTINGS.maxFrameChange)) {
    currentRaw=null;currentDelta=null;resetFilters();
    ui.stabilityStatus.textContent='Unreliable angle';
    setStatus('Sudden angle change rejected. Reposition your arm and hold still.');
    return;
  }
  lastMovement=measured;
  smoother.push(measured);
  if (smoother.length>SETTINGS.smoothingWindow)smoother.shift();
  const smoothed=median(smoother);
  const movement=smoothed>SETTINGS.neutralTolerance?'FLEXION':smoothed< -SETTINGS.neutralTolerance?'EXTENSION':'NEUTRAL';
  ui.movement.textContent=movement;
  ui.angle.textContent=`${Math.abs(smoothed).toFixed(1)}°`;
  if (!recording) {
    ui.stabilityStatus.textContent='Ready to record';
    setStatus('Tracking ready. Start assessment and hold each movement at a steady end position.');
    return;
  }
  // Do not let a transition between opposite directions form a false stable hold.
  if (stable.length && Math.sign(stable[stable.length-1]) !== Math.sign(smoothed) &&
      Math.abs(stable[stable.length-1])>SETTINGS.neutralTolerance && Math.abs(smoothed)>SETTINGS.neutralTolerance) stable=[];
  stable.push(smoothed);
  if (stable.length>SETTINGS.stableWindow)stable.shift();
  if (stable.length<SETTINGS.stableWindow) {
    ui.stabilityStatus.textContent=`Collecting frames (${stable.length}/${SETTINGS.stableWindow})`;
    return;
  }
  const variation=Math.max(...stable)-Math.min(...stable);
  if (variation>SETTINGS.stableTolerance) {
    ui.stabilityStatus.textContent=`Hold steady · variation ${variation.toFixed(1)}°`;
    return;
  }
  const angle=median(stable);
  ui.stabilityStatus.textContent='Stable hold accepted';
  if (angle>SETTINGS.neutralTolerance) {
    acceptedFlexion++;
    maxFlexion=Math.max(maxFlexion,angle);
  } else if (angle< -SETTINGS.neutralTolerance) {
    acceptedExtension++;
    maxExtension=Math.max(maxExtension,-angle);
  }
  updateNumbers();
  setStatus('Recording. Stable movements are being measured. Hold flexion and extension separately.');
}
function frameLoop() {
  if (!stream || !landmarker) return;
  try {
    if (ui.video.readyState>=2 && ui.video.currentTime!==lastVideoTime) {
      lastVideoTime=ui.video.currentTime;
      const result=landmarker.detectForVideo(ui.video,performance.now());
      processResult(result);
    }
  } catch (error) {
    console.error(error);ui.landmarkStatus.textContent='Inference error — see browser console';setStatus(`Tracking error: ${error.message}`);
    resetFilters();
  }
  updateButtons();
  rafId=requestAnimationFrame(frameLoop);
}
function calibrate() {
  if (!stream || recording || currentRaw===null)return;
  calibration=currentRaw; flexionDirection=null; currentDelta=null;
  resetRecordingData();
  ui.neutralStatus.textContent='Set';ui.flexStatus.textContent='Not set';
  ui.stabilityStatus.textContent='Waiting for flexion';
  setStatus('Neutral calibrated. Bend toward your palm, then select “Identify flexion”.');
  updateButtons();
}
function setFlexion() {
  if (!stream || recording || calibration===null || currentDelta===null)return;
  if (Math.abs(currentDelta)<SETTINGS.directionThreshold){setStatus('Bend farther toward the palm before identifying flexion.');return;}
  flexionDirection=currentDelta>0?1:-1;
  resetRecordingData();ui.flexStatus.textContent='Set';
  setStatus('Flexion direction set. Return to neutral, then start assessment.');updateButtons();
}
function readRecords() {
  try {const r=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');return Array.isArray(r)?r:[];}
  catch {return [];}
}
function writeRecords(data) {
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data));return true;}
  catch(error){setStatus(`Cannot store assessment on this device: ${error.message}. Try exporting an existing CSV.`);return false;}
}
function renderHistory() {
  const data=readRecords();
  ui.body.replaceChildren();
  if (!data.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=4;td.textContent='No saved assessments yet.';tr.append(td);ui.body.append(tr);}
  for(const r of [...data].reverse()){
    const tr=document.createElement('tr');
    for(const value of [new Date(r.timestamp).toLocaleString(),r.hand,`${r.flexion.toFixed(1)}°`,`${r.extension.toFixed(1)}°`]) {
      const td=document.createElement('td');td.textContent=value;tr.append(td);
    } ui.body.append(tr);
  }
  ui.count.textContent=`${data.length} saved assessment${data.length===1?'':'s'}`;
}
function toggleRecording() {
  if (!stream || !landmarker)return;
  if (!recording) {
    if (calibration===null || flexionDirection===null)return;
    resetRecordingData();recording=true;
    setStatus(`Recording ${hand.toLowerCase()} wrist. Hold flexion and extension for stable measurements.`);
  } else {
    recording=false;
    if (acceptedFlexion===0 || acceptedExtension===0 || !maxFlexion || !maxExtension) {
      setStatus('Not saved: a stable measurement is needed for BOTH flexion and extension. Start a new trial and hold each direction longer.');
    } else {
      const saved=writeRecords([...readRecords(),{
        timestamp:new Date().toISOString(),hand,flexion:Number(maxFlexion.toFixed(1)),extension:Number(maxExtension.toFixed(1))
      }]);
      if (saved){renderHistory();setStatus(`Assessment saved on this device: ${hand}, flexion ${maxFlexion.toFixed(1)}°, extension ${maxExtension.toFixed(1)}°.`);}
    }
  }updateButtons();
}
function exportCSV() {
  const data=readRecords();
  if (!data.length){setStatus('No assessments to export yet.');return;}
  const csv=['timestamp,hand,max_flexion_degrees,max_extension_degrees',...data.map(r=>[r.timestamp,r.hand,r.flexion,r.extension].join(','))].join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='wrist_assessments_demo.csv';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
ui.start.addEventListener('click',startCamera);
ui.stop.addEventListener('click',()=>{stopCamera();setStatus('Camera stopped. Unsaved recording discarded.');});
ui.calibrate.addEventListener('click',calibrate);
ui.flexion.addEventListener('click',setFlexion);
ui.record.addEventListener('click',toggleRecording);
ui.hand.addEventListener('change',()=>{
  if (recording){ui.hand.value=hand;return;}
  hand=ui.hand.value;calibration=null;flexionDirection=null;currentRaw=null;currentDelta=null;
  resetRecordingData();ui.neutralStatus.textContent='Not set';ui.flexStatus.textContent='Not set';
  ui.stabilityStatus.textContent='Waiting';
  ui.landmarkStatus.textContent='Waiting for selected wrist';
  setStatus(`Switched to ${hand.toLowerCase()} wrist. Calibrate neutral for the newly selected wrist.`);updateButtons();
});
ui.export.addEventListener('click',exportCSV);
ui.clear.addEventListener('click',()=>{
  if (confirm('Delete all assessments saved in this browser on this device?')){
    writeRecords([]);renderHistory();setStatus('Local assessment history cleared.');
  }
});
window.addEventListener('pagehide',()=>{if(stream)stream.getTracks().forEach(track=>track.stop());});
renderHistory();updateButtons();
