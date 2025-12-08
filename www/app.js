import { connect } from 'twilio-video';
import { PushNotifications } from '@capacitor/push-notifications';

// ============================================
// CONFIGURACIÓN Y CONSTANTES (V6 COST SAVER)
// ============================================
const MY_ID = "puerta-admin-v2"; 
const ROOM_NAME = 'sala-principal'; 

// 🛑 URLs EXACTAS (Verifica tus despliegues en Terminal)
// 1. Registro de Token FCM (Gen 2)
const API_URL_REGISTRO  = 'https://registrarreceptor-6rmawrifca-uc.a.run.app';
// 2. Obtención de Token Twilio (Gen 1)
const API_URL_TOKEN     = 'https://obtenertokentwilio-6rmawrifca-uc.a.run.app';
// 3. Responder/Aceptar llamada (Gen 2 - NUEVA)
const API_URL_RESPONDER = 'https://us-central1-puerta-c3a71.cloudfunctions.net/responderLlamada';

// Variables Globales
let activeRoom = null;
let currentLlamadaId = null; // <--- AQUÍ GUARDAMOS QUIÉN LLAMA
let audioContext = null;
let ringtoneOscillator = null; 
let isMuted = false;
let wakeLock = null;

// ============================================
// SISTEMA DE LOGS
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
            log('✅ Wake Lock ACTIVO');
        }
    } catch (err) { console.log(err); }
}

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !wakeLock) {
        await requestWakeLock();
    }
});

// ============================================
// INICIALIZACIÓN
// ============================================
window.iniciarApp = async function() {
    try {
        log('🚀 INICIANDO MONITOR V6 (Cost Saver)...');
        
        // 1. AudioContext
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // 2. Limpieza UI
        const onboarding = document.getElementById('onboarding');
        if(onboarding) {
            onboarding.style.opacity = '0';
            setTimeout(() => onboarding.remove(), 500);
        }
        
        // 3. Servicios
        await requestWakeLock();
        await iniciarCapacitor();
        iniciarVisualizador();
        activarModoSegundoPlano();

        // 4. Estado
        setStatus("✅ Listo para recibir llamadas");
        updateNetworkStatus('online');
        
    } catch (e) { 
        log('❌ ERROR FATAL: ' + e.message);
        alert("Error: " + e.message); 
    }
};

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
                text: "Esperando llamadas...",
                color: '#2ecc71',
                hidden: false,
                bigText: true,
                resume: true,
                silent: false
            });
            bg.on('activate', () => {
                bg.disableWebViewOptimizations(); 
                log('🔋 Background Mode: ACTIVO');
            });
            if (bg.isScreenOff && bg.isScreenOff()) {
                bg.wakeUp();
                bg.unlock();
            }
        }
    }, false);
}

// ============================================
// NOTIFICACIONES (CAPTURA DE ID)
// ============================================
async function iniciarCapacitor() {
    if (!window.Capacitor) return;
    
    try {
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
        
        if (perm.receive !== 'granted') {
            log('⚠️ Permisos Push DENEGADOS');
            return;
        }

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
            log('📲 Token FCM OK');
            await registrarEnServidor(token.value);
        });

        // CASO 1: Recibido
        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            log('🔔 NOTIFICACIÓN RECIBIDA');
            procesarNotificacion(notification);
        });

        // CASO 2: Tocado
        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
            log('👆 Usuario abrió notificación');
            procesarNotificacion(notification.notification);
            traerAlFrente();
        });

    } catch (e) {
        log('⚠️ Error Capacitor: ' + e.message);
    }
}

function procesarNotificacion(notification) {
    // 1. CAPTURAR EL ID DE LA LLAMADA (Vital para responder)
    if (notification.data && notification.data.llamadaId) {
        currentLlamadaId = notification.data.llamadaId;
        log('🆔 ID LLAMADA: ' + currentLlamadaId);
    } else {
        log('⚠️ Notificación sin ID de llamada');
    }

    // 2. Activar Timbre y UI
    startRinging();
    setStatus("🔔 TIMBRE SONANDO");
    document.getElementById('avatar').innerText = "🔔";
    document.getElementById('controls-incoming').classList.remove('hidden');
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
        log('✅ Registrado en servidor');
    } catch (e) {
        log('❌ Fallo registro: ' + e.message);
    }
}

// ============================================
// CONTESTAR (LÓGICA V6)
// ============================================
window.contestarLlamada = async function() {
    log('📞 INICIANDO CONEXIÓN...');
    stopRinging();

    try {
        // PASO 1: AVISAR AL VISITANTE (Señalización)
        if (currentLlamadaId) {
            log('📡 Enviando señal ACEPTADA...');
            const resResp = await fetch(API_URL_RESPONDER, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ llamadaId: currentLlamadaId })
            });
            if(!resResp.ok) log('⚠️ Advertencia: No se pudo avisar al servidor');
        } else {
            log('⚠️ No hay ID de llamada, conectando forzosamente...');
        }

        // PASO 2: OBTENER TOKEN DE VIDEO
        log('🔑 Obteniendo credenciales...');
        const res = await fetch(API_URL_TOKEN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identidad: 'Admin-' + Date.now(), sala: ROOM_NAME })
        });
        
        if(!res.ok) throw new Error('Error token: ' + res.status);
        const data = await res.json();

        // PASO 3: CONECTAR A TWILIO
        log('☁️ Conectando video...');
        activeRoom = await connect(data.token, {
            name: ROOM_NAME,
            audio: { echoCancellation: true, autoGainControl: true },
            video: false 
        });

        log(`✅ EN LLAMADA: ${activeRoom.name}`);
        
        // UI Update
        document.getElementById('controls-incoming').classList.add('hidden');
        document.getElementById('controls-active').classList.remove('hidden');
        document.getElementById('btn-mute').style.display = 'flex'; 
        setStatus("🟢 EN LLAMADA");
        document.getElementById('avatar').innerText = "🔊";

        // Gestión Audio
        activeRoom.participants.forEach(p => participantConnected(p));
        activeRoom.on('participantConnected', p => participantConnected(p));
        activeRoom.on('disconnected', () => finalizarLlamada(false));

    } catch (err) {
        log('❌ Error: ' + err.message);
        alert("Error al contestar: " + err.message);
        rechazarLlamada();
    }
};

function participantConnected(participant) {
    log(`👤 Visitante conectado: ${participant.identity}`);
    participant.on('trackSubscribed', track => {
        log('🔊 Audio remoto recibido');
        document.getElementById('remoteAudio').srcObject = new MediaStream([track.mediaStreamTrack]);
        conectarVisualizador(new MediaStream([track.mediaStreamTrack]));
    });
}

window.rechazarLlamada = function() {
    stopRinging();
    resetState();
    if(window.Capacitor) PushNotifications.removeAllDeliveredNotifications();
    log('❌ Llamada rechazada');
};

window.finalizarLlamada = function(disconnect = true) {
    if (disconnect && activeRoom) {
        activeRoom.disconnect();
        activeRoom = null;
    }
    resetState();
};

function resetState() {
    stopRinging();
    activeRoom = null;
    currentLlamadaId = null; // Limpiamos ID
    document.getElementById('controls-incoming').classList.add('hidden');
    document.getElementById('controls-active').classList.add('hidden');
    document.getElementById('btn-mute').style.display = 'none';
    setStatus("✅ Listo para recibir llamadas");
    document.getElementById('avatar').innerText = "🔒";
}

// ============================================
// UTILIDADES
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
        gain.gain.value = 0.1;
        ringtoneOscillator.start();
    } catch (e) { log('⚠️ Error timbre: ' + e.message); }
}

function stopRinging() {
    if (ringtoneOscillator) { 
        try { ringtoneOscillator.stop(); } catch(e){} 
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
            if (i === 0) ctx.moveTo(x, y); 
            else ctx.lineTo(x, y); 
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
