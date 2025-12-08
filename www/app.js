import { connect } from 'twilio-video';
import { PushNotifications } from '@capacitor/push-notifications';

// ============================================
// CONFIGURACIÓN FIREBASE (Modo Compat - Compatible con tu setup actual)
// ============================================
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyDMxrgcvTwO54m6NZjIGLTIGjKLYYYqF0E",
    authDomain: "puerta-c3a71.firebaseapp.com",
    projectId: "puerta-c3a71",
    storageBucket: "puerta-c3a71.firebasestorage.app",
    messagingSenderId: "830550601352",
    appId: "1:830550601352:web:f7125f76a1256aeb4db93d"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

// ============================================
// CONFIGURACIÓN
// ============================================
const MY_ID = "puerta-admin-v2"; 
const ROOM_NAME = 'sala-principal'; 

const API_URL_REGISTRO  = 'https://registrarreceptor-6rmawrifca-uc.a.run.app';
const API_URL_TOKEN     = 'https://us-central1-puerta-c3a71.cloudfunctions.net/obtenerTokenTwilio';

let activeRoom = null;
let currentLlamadaId = null; 
let audioContext = null;
let ringtoneOscillator = null; 
let isMuted = false;
let wakeLock = null;
let firestoreUnsubscribe = null;

// ============================================
// LOGS
// ============================================
function log(msg) {
    const logDiv = document.getElementById('console-log');
    if(logDiv) {
        const time = new Date().toLocaleTimeString();
        logDiv.innerHTML = `<div>[${time}] ${msg}</div>` + logDiv.innerHTML;
    }
    console.log(`[App] ${msg}`);
}

/* --- EVENTO RESUME --- */
document.addEventListener('resume', () => {
    log('☀️ APP EN PRIMER PLANO');
    requestWakeLock();
    if(window.Capacitor) PushNotifications.removeAllDeliveredNotifications();
}, false);

// ============================================
// WAKE LOCK
// ============================================
async function requestWakeLock() {
    if (document.visibilityState !== 'visible') return;
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {}
}

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        if(!wakeLock) await requestWakeLock();
    }
});

// ============================================
// INICIALIZACIÓN
// ============================================
window.iniciarApp = async function() {
    try {
        log('🚀 INICIANDO V7.0 (Firebase Directo)...');
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        const onboarding = document.getElementById('onboarding');
        if(onboarding) {
            onboarding.style.opacity = '0';
            setTimeout(() => onboarding.remove(), 500);
        }
        
        await requestWakeLock();
        await iniciarCapacitor();
        iniciarVisualizador();
        activarModoSegundoPlano();

        // 🔥 NUEVO: ESCUCHA DIRECTA DE FIREBASE
        iniciarEscuchaFirebase();
        
        // 🔥 NUEVO: LIMPIEZA AUTOMÁTICA
        iniciarLimpiezaAutomatica();

        setStatus("✅ Listo para recibir llamadas");
        updateNetworkStatus('online');
        
    } catch (e) { 
        log('❌ ERROR: ' + e.message);
        alert("Error: " + e.message); 
    }
};

// ============================================
// 🔥 ESCUCHA DIRECTA FIREBASE (COMPAT MODE)
// ============================================
function iniciarEscuchaFirebase() {
    log('👂 Iniciando escucha DIRECTA de Firebase...');
    
    if (firestoreUnsubscribe) {
        firestoreUnsubscribe();
    }
    
    // Query usando sintaxis compat
    const query = db.collection('llamadas')
        .where('sala', '==', ROOM_NAME);
    
    firestoreUnsubscribe = query.onSnapshot((snapshot) => {
        log(`🔔 Firebase: ${snapshot.size} llamada(s) en total`);
        
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                const id = change.doc.id;
                
                // Filtro: Solo procesamos "pendiente" o "llamando"
                if (data.estado !== 'pendiente' && data.estado !== 'llamando') {
                    return;
                }
                
                log(`🚨 ¡LLAMADA DETECTADA! ID: ${id} (Estado: ${data.estado})`);
                
                // Solo procesar si no estamos ya en llamada
                if (!activeRoom && !ringtoneOscillator) {
                    currentLlamadaId = id;
                    startRinging();
                    setStatus("🔔 TIMBRE SONANDO");
                    document.getElementById('avatar').innerText = "🔔";
                    document.getElementById('controls-incoming').classList.remove('hidden');
                    traerAlFrente();
                }
            }
        });
    }, (error) => {
        log('❌ Error escuchando Firebase: ' + error.message);
    });
    
    log('✅ Listener de Firebase activo');
}

// ============================================
// 🔥 LIMPIEZA AUTOMÁTICA
// ============================================
function iniciarLimpiezaAutomatica() {
    log('🧹 Iniciando sistema de limpieza automática...');
    setTimeout(limpiarLlamadasViejas, 5000);
    setInterval(limpiarLlamadasViejas, 10 * 60 * 1000);
}

async function limpiarLlamadasViejas() {
    try {
        const cincominutosAtras = firebase.firestore.Timestamp.fromDate(
            new Date(Date.now() - 5 * 60 * 1000)
        );
        
        const snapshot = await db.collection('llamadas')
            .where('timestamp', '<', cincominutosAtras)
            .get();
        
        if (snapshot.empty) {
            log('✅ BD limpia (no hay llamadas viejas)');
            return;
        }
        
        const batch = db.batch();
        let count = 0;
        
        snapshot.forEach((doc) => {
            batch.delete(doc.ref);
            count++;
        });
        
        await batch.commit();
        log(`🗑️ ${count} llamada(s) antigua(s) eliminada(s)`);
        
    } catch (error) {
        log('⚠️ Error en limpieza: ' + error.message);
    }
}

// ============================================
// MODO SEGUNDO PLANO
// ============================================
function activarModoSegundoPlano() {
    document.addEventListener('deviceready', () => {
        if (window.cordova && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
            const bg = window.cordova.plugins.backgroundMode;
            bg.enable();
            bg.setDefaults({
                title: "Monitor Puerta",
                text: "Activo",
                color: '#2ecc71',
                hidden: false,
                bigText: true,
                resume: true,
                silent: false
            });
            bg.on('activate', () => {
                bg.disableWebViewOptimizations(); 
            });
            if (bg.isScreenOff && bg.isScreenOff()) {
                bg.wakeUp();
                bg.unlock();
            }
        }
    }, false);
}

// ============================================
// NOTIFICACIONES
// ============================================
async function iniciarCapacitor() {
    if (!window.Capacitor) return;
    
    try {
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
        if (perm.receive !== 'granted') return;

        await PushNotifications.createChannel({
            id: 'timbre_urgente',       
            name: 'Timbre Puerta',
            importance: 5,
            visibility: 1,
            vibration: true,
            sound: 'default'
        });

        await PushNotifications.register();

        PushNotifications.addListener('registration', async (token) => {
            log('📲 Token OK');
            await registrarEnServidor(token.value);
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            log('🔔 NOTIFICACIÓN PUSH (Backup)');
            traerAlFrente();
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
            log('👆 Acción Notificación');
            traerAlFrente();
        });

    } catch (e) { log('⚠️ Error Push: ' + e.message); }
}

function traerAlFrente() {
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
        const bg = window.cordova.plugins.backgroundMode;
        bg.wakeUp();
        bg.unlock();
        bg.moveToForeground();
        window.focus();
    }
}

async function registrarEnServidor(token) {
    try {
        await fetch(API_URL_REGISTRO, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, sala: ROOM_NAME })
        });
    } catch (e) {}
}

// ============================================
// CONTESTAR
// ============================================
window.contestarLlamada = async function() {
    log('📞 CONECTANDO...');
    stopRinging();

    try {
        // Actualizar estado a "aceptada"
        if (currentLlamadaId) {
            log('📝 Actualizando estado...');
            await db.collection('llamadas').doc(currentLlamadaId).update({
                estado: 'aceptada'
            });
        }

        // Obtener token
        const res = await fetch(API_URL_TOKEN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identidad: 'Admin-' + Date.now(), sala: ROOM_NAME })
        });
        
        if(!res.ok) throw new Error('Error token');
        const data = await res.json();

        // Conectar Twilio
        activeRoom = await connect(data.token, {
            name: ROOM_NAME,
            audio: { echoCancellation: true, autoGainControl: true },
            video: false 
        });

        log(`✅ EN LLAMADA`);
        
        document.getElementById('controls-incoming').classList.add('hidden');
        document.getElementById('controls-active').classList.remove('hidden');
        document.getElementById('btn-mute').style.display = 'flex'; 
        setStatus("🟢 EN LLAMADA");
        document.getElementById('avatar').innerText = "🔊";

        activeRoom.participants.forEach(p => participantConnected(p));
        activeRoom.on('participantConnected', p => participantConnected(p));
        activeRoom.on('disconnected', () => finalizarLlamada(false));

    } catch (err) {
        log('❌ Error: ' + err.message);
        rechazarLlamada();
    }
};

function participantConnected(participant) {
    log(`👤 Visitante: ${participant.identity}`);
    participant.on('trackSubscribed', track => {
        document.getElementById('remoteAudio').srcObject = new MediaStream([track.mediaStreamTrack]);
        conectarVisualizador(new MediaStream([track.mediaStreamTrack]));
    });
}

window.rechazarLlamada = async function() {
    stopRinging();
    
    if (currentLlamadaId) {
        try {
            await db.collection('llamadas').doc(currentLlamadaId).delete();
            log('🗑️ Llamada rechazada eliminada');
        } catch (error) {
            log('⚠️ Error eliminando: ' + error.message);
        }
    }
    
    resetState();
    if(window.Capacitor) PushNotifications.removeAllDeliveredNotifications();
    log('❌ Rechazada');
};

window.finalizarLlamada = async function(disconnect = true) {
    if (disconnect && activeRoom) {
        activeRoom.disconnect();
        activeRoom = null;
    }
    
    if (currentLlamadaId) {
        try {
            await db.collection('llamadas').doc(currentLlamadaId).delete();
            log('🗑️ Llamada finalizada eliminada');
        } catch (error) {
            log('⚠️ Error eliminando: ' + error.message);
        }
    }
    
    resetState();
};

function resetState() {
    stopRinging();
    activeRoom = null;
    currentLlamadaId = null; 
    document.getElementById('controls-incoming').classList.add('hidden');
    document.getElementById('controls-active').classList.add('hidden');
    document.getElementById('btn-mute').style.display = 'none';
    setStatus("✅ Listo para recibir llamadas");
    document.getElementById('avatar').innerText = "🔒";
}

// ============================================
// AUDIO Y VISUALIZADOR
// ============================================
function startRinging() {
    if (!audioContext) return;
    try {
        if(audioContext.state === 'suspended') audioContext.resume();
        stopRinging(); 
        ringtoneOscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        ringtoneOscillator.type = 'square';
        ringtoneOscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        ringtoneOscillator.connect(gain);
        gain.connect(audioContext.destination);
        gain.gain.value = 0.3;
        ringtoneOscillator.start();
        log('🔔 SONIDO DE TIMBRE ACTIVADO');
    } catch (e) {
        log('❌ Error timbre: ' + e.message);
    }
}

function stopRinging() {
    if (ringtoneOscillator) { 
        try { 
            ringtoneOscillator.stop(); 
            log('🔕 Timbre detenido');
        } catch(e){} 
        ringtoneOscillator = null; 
    }
}

window.toggleMute = function() {
    if (!activeRoom || !activeRoom.localParticipant) return;
    isMuted = !isMuted;
    activeRoom.localParticipant.audioTracks.forEach(pub => {
        if(isMuted) pub.track.disable(); else pub.track.enable();
    });
    document.getElementById('btn-mute').classList.toggle('muted', isMuted);
};

function setStatus(msg) { 
    const el = document.getElementById('status-text');
    if(el) el.innerText = msg; 
}

function updateNetworkStatus(status) {
    const dot = document.getElementById('net-dot');
    const txt = document.getElementById('net-text');
    if(dot) dot.className = 'dot ' + status;
    if(txt) txt.innerText = status === 'online' ? 'En Línea' : 'Offline';
}

function iniciarVisualizador() {
    const canvas = document.getElementById('wave-visualizer');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; 
    canvas.height = 300;
    
    function drawWave() {
        requestAnimationFrame(drawWave);
        if (!window.analyserNode) return; 
        const bufferLength = window.analyserNode.frequencyBinCount; 
        const dataArray = new Uint8Array(bufferLength);
        window.analyserNode.getByteTimeDomainData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 2; 
        ctx.strokeStyle = '#2ecc71'; 
        ctx.beginPath();
        const sliceWidth = canvas.width / bufferLength; 
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0; 
            const y = v * (canvas.height / 2);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); 
            x += sliceWidth;
        }
        ctx.lineTo(canvas.width, canvas.height / 2); 
        ctx.stroke();
    }
    drawWave();
}

function conectarVisualizador(stream) {
    if (!audioContext) return;
    try {
        const source = audioContext.createMediaStreamSource(stream);
        window.analyserNode = audioContext.createAnalyser(); 
        window.analyserNode.fftSize = 2048;
        source.connect(window.analyserNode);
        const waveVis = document.getElementById('wave-visualizer');
        if(waveVis) waveVis.classList.add('active');
    } catch (e) {}
}
