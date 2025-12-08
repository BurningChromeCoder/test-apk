import { connect } from 'twilio-video';
import { PushNotifications } from '@capacitor/push-notifications'; // Importación directa si usas Vite+Capacitor
// ============================================
// CONFIGURACIÓN Y CONSTANTES
// ============================================
const MY_ID = "puerta-admin-v2"; 
const ROOM_NAME = 'sala-principal'; // Nombre fijo de la sala


// PON ESTO EN SU LUGAR (URLs Explícitas):
const API_URL_REGISTRO = 'https://registrarreceptor-6rmawrifca-uc.a.run.app';
const API_URL_TOKEN    = 'https://us-central1-puerta-c3a71.cloudfunctions.net/obtenerTokenTwilio';

// Variables Globales
let activeRoom = null;
let localStream = null; // Stream local (micrófono)
let audioContext = null;
let analyser = null;
let ringtoneOscillator = null; 
let callTimeout = null;
let isMuted = false;
let wakeLock = null;
let keepaliveInterval = null;
let keepaliveCount = 0;
let isCapacitorAvailable = false;

// ============================================
// SISTEMA DE LOGS VISUAL
// ============================================
function log(msg) {
    const logDiv = document.getElementById('console-log');
    if(logDiv) {
        const time = new Date().toLocaleTimeString();
        logDiv.innerHTML = `<div>[${time}] ${msg}</div>` + logDiv.innerHTML;
    }
    console.log(`[App] ${msg}`);
}

/* --- ANTI-CORTE 1: EVENTO RESUME --- */
document.addEventListener('resume', () => {
    log('☀️ APP EN PRIMER PLANO (Resume)');
    requestWakeLock();
    // En Twilio, si la sala se desconectó por red, suele intentar reconectar sola.
    // Aquí verificamos si perdimos la sala completamente.
    if (activeRoom && activeRoom.state === 'disconnected') {
        log('⚠️ Sala desconectada. Finalizando UI...');
        finalizarLlamada(false);
    }
}, false);

// ============================================
// WAKE LOCK (Mantener pantalla activa)
// ============================================
async function requestWakeLock() {
    if (document.visibilityState !== 'visible') return;

    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            log('✅ Wake Lock ACTIVO');
            wakeLock.addEventListener('release', () => {
                log('ℹ️ Wake Lock liberado');
                wakeLock = null;
            });
        }
    } catch (err) {
        log(`❌ Error WakeLock: ${err.message}`);
    }
}

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !wakeLock) {
        await requestWakeLock();
    }
});

// ============================================
// KEEPALIVE (Monitor de estado)
// ============================================
function iniciarKeepalive() {
    if (keepaliveInterval) clearInterval(keepaliveInterval);
    
    keepaliveInterval = setInterval(() => {
        keepaliveCount++;
        const counterEl = document.getElementById('keepalive-count');
        if(counterEl) counterEl.innerText = keepaliveCount;
        
        // Verificamos AudioContext para que no se duerma
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
            log('🔊 AudioContext despertado');
        }
        
    }, 4000); 
}

// ============================================
// INICIALIZACIÓN PRINCIPAL
// ============================================
window.iniciarApp = async function() {
    try {
        log('🚀 INICIANDO MONITOR V4 (Twilio)...');
        
        // 1. AudioContext
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // 2. Permisos Micrófono (Pre-calentamiento)
        try {
            const streamTemp = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamTemp.getTracks().forEach(t => t.stop());
            log('✅ Permisos audio OK');
        } catch(e) {
            log('❌ Error permisos audio: ' + e.message);
        }
        
        // 3. UI Cleanup
        const onboarding = document.getElementById('onboarding');
        if(onboarding) {
            onboarding.style.opacity = '0';
            setTimeout(() => onboarding.remove(), 500);
        }
        
        // 4. Servicios
        await requestWakeLock();
        await iniciarCapacitor();
        iniciarVisualizador();
        iniciarKeepalive();
        
        // 5. Estado Inicial
        setStatus("✅ Listo para recibir llamadas");
        updateNetworkStatus('online');
        
    } catch (e) { 
        log('❌ ERROR FATAL: ' + e.message);
        alert("Error: " + e.message); 
    }
};

// ============================================
// CAPACITOR / FCM
// ============================================
async function iniciarCapacitor() {
    if (!window.Capacitor) {
        log('🌐 Modo WEB (Sin Push)');
        return;
    }
    
    isCapacitorAvailable = true;
    try {
        log('📱 Iniciando Push Notifications...');
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
            log('📲 Token FCM obtenido');
            await registrarEnServidor(token.value);
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            log('🔔 NOTIFICACIÓN RECIBIDA');
            // Aquí detectamos que es una llamada
            gestionarNotificacionLlamada(notification);
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
            log('🔔 Usuario tocó notificación. Abriendo...');
            window.focus();
            gestionarNotificacionLlamada(notification.notification);
        });

    } catch (e) {
        log('⚠️ Error Capacitor: ' + e.message);
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
        log('❌ Fallo registro server: ' + e.message);
    }
}

// Lógica para reaccionar al Timbre (sea foreground o background)
function gestionarNotificacionLlamada(notification) {
    // Verificamos si es una llamada (puedes añadir lógica extra basada en 'data')
    setStatus("🔔 TIMBRE SONANDO");
    document.getElementById('avatar').innerText = "🔔";
    document.getElementById('controls-incoming').classList.remove('hidden');
    startRinging();
    
    // Auto-cancelar si no se contesta en 30s
    if (callTimeout) clearTimeout(callTimeout);
    callTimeout = setTimeout(() => {
        log('⏱️ Timeout sin contestar');
        rechazarLlamada();
    }, 30000);
}

// ============================================
// BACKGROUND MODE (Cordova Plugin)
// ============================================
document.addEventListener('deviceready', () => {
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
        window.cordova.plugins.backgroundMode.enable();
        window.cordova.plugins.backgroundMode.setDefaults({
            title: "Monitor Activo",
            text: "Listo para llamadas",
            color: '#2ecc71',
            hidden: false,
            bigText: true
        });
        window.cordova.plugins.backgroundMode.on('activate', () => {
            window.cordova.plugins.backgroundMode.disableWebViewOptimizations(); 
        });
        log('🔋 Background Mode Configurado');
    }
}, false);

// ============================================
// LÓGICA DE LLAMADA TWILIO
// ============================================
window.contestarLlamada = async function() {
    log('📞 CONTESTANDO...');
    stopRinging();
    if (callTimeout) clearTimeout(callTimeout);

    try {
        // 1. Obtener Token
        log('🔑 Solicitando acceso...');
        const res = await fetch(API_URL_TOKEN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identidad: 'Admin-' + Date.now(), sala: ROOM_NAME })
        });
        
        if(!res.ok) throw new Error('Error obteniendo token');
        const data = await res.json();
        const token = data.token;

        // 2. Conectar a la Sala
        log('☁️ Conectando a Twilio...');
        activeRoom = await connect(token, {
            name: ROOM_NAME,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false // Cambiar a true si deseas enviar video
        });

        log(`✅ CONECTADO A SALA: ${activeRoom.name}`);
        
        // 3. UI Update
        document.getElementById('controls-incoming').classList.add('hidden');
        document.getElementById('controls-active').classList.remove('hidden');
        document.getElementById('btn-mute').style.display = 'flex'; 
        setStatus("🟢 EN LLAMADA");
        document.getElementById('avatar').innerText = "🔊";

        // 4. Manejo de Participantes (Visitante)
        
        // A. Los que ya están
        activeRoom.participants.forEach(participantConnected);
        
        // B. Los que entran después
        activeRoom.on('participantConnected', participantConnected);
        
        // C. Cuando alguien se va
        activeRoom.on('participantDisconnected', participantDisconnected);
        
        // D. Si yo me desconecto
        activeRoom.on('disconnected', () => {
            log('🔴 Desconectado de la sala');
            finalizarLlamada(false);
        });

    } catch (err) {
        log('❌ Error conexión: ' + err.message);
        alert("Error al conectar: " + err.message);
        rechazarLlamada();
    }
};

function participantConnected(participant) {
    log(`👤 Participante conectado: ${participant.identity}`);

    participant.on('trackSubscribed', track => {
        log('🔊 Audio remoto recibido');
        const audioEl = document.getElementById('remoteAudio');
        track.attach(audioEl);
        // Conectamos visualizador si es posible
        // (Nota: track.mediaStreamTrack es el objeto nativo)
        const stream = new MediaStream([track.mediaStreamTrack]);
        conectarVisualizador(stream);
    });
}

function participantDisconnected(participant) {
    log(`👋 Participante salió: ${participant.identity}`);
    // Opcional: Cerrar llamada si el visitante se va
    // finalizarLlamada(); 
}

window.rechazarLlamada = function() {
    log('❌ Llamada rechazada/cancelada');
    resetState();
};

window.finalizarLlamada = function(disconnect = true) {
    log('🔴 Finalizando...');
    if (disconnect && activeRoom) {
        activeRoom.disconnect();
        activeRoom = null;
    }
    resetState();
};

function resetState() {
    stopRinging();
    if (callTimeout) clearTimeout(callTimeout);
    
    // Reset Variables
    activeRoom = null;
    
    // UI Reset
    document.getElementById('controls-incoming').classList.add('hidden');
    document.getElementById('controls-active').classList.add('hidden');
    document.getElementById('btn-mute').style.display = 'none';
    const waveVis = document.getElementById('wave-visualizer');
    if(waveVis) waveVis.classList.remove('active');
    
    setStatus("✅ Listo para recibir llamadas");
    document.getElementById('avatar').innerText = "🔒";
    updateNetworkStatus('online');
}

// ============================================
// UTILIDADES (Audio y UI)
// ============================================
function startRinging() {
    if (!audioContext) return;
    try {
        if(audioContext.state === 'suspended') audioContext.resume();
        ringtoneOscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        ringtoneOscillator.type = 'square';
        ringtoneOscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        ringtoneOscillator.connect(gain);
        gain.connect(audioContext.destination);
        gain.gain.value = 0.1; // Volumen bajo
        ringtoneOscillator.start();
    } catch (e) { log('⚠️ Error timbre: ' + e.message); }
}

function stopRinging() {
    if (ringtoneOscillator) { 
        try { ringtoneOscillator.stop(); } catch(e){} 
        ringtoneOscillator = null; 
    }
    if (navigator.vibrate) navigator.vibrate(0);
}

window.toggleMute = function() {
    if (!activeRoom || !activeRoom.localParticipant) return;
    
    isMuted = !isMuted;
    
    // Twilio: Iterar sobre tracks de audio y deshabilitar/habilitar
    activeRoom.localParticipant.audioTracks.forEach(publication => {
        if(isMuted) publication.track.disable();
        else publication.track.enable();
    });

    document.getElementById('btn-mute').classList.toggle('muted', isMuted);
    log(isMuted ? '🔇 MUTEADO' : '🔊 ACTIVO');
};

function setStatus(msg) { 
    const el = document.getElementById('status-text');
    if(el) el.innerText = msg; 
}

function updateNetworkStatus(status) {
    const dot = document.getElementById('net-dot');
    const txt = document.getElementById('net-text');
    if(dot) dot.className = 'dot ' + status;
    if(txt) txt.innerText = status === 'online' ? 'En Línea' : 'Desconectado';
}

function iniciarVisualizador() {
    const canvas = document.getElementById('wave-visualizer');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; 
    canvas.height = 300;
    
    function drawWave() {
        requestAnimationFrame(drawWave);
        if (!analyser) return;
        
        const bufferLength = analyser.frequencyBinCount; 
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);
        
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
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const waveVis = document.getElementById('wave-visualizer');
        if(waveVis) waveVis.classList.add('active');
    } catch (e) {
        log('⚠️ Error visualizador: ' + e.message);
    }
}
