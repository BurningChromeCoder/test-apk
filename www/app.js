import { connect } from 'twilio-video';
import { PushNotifications } from '@capacitor/push-notifications';

// ============================================
// CONFIGURACIÓN Y CONSTANTES (V5 STABLE)
// ============================================
const MY_ID = "puerta-admin-v2"; 
const ROOM_NAME = 'sala-principal'; 

// 🛑 URLs EXACTAS (Ajustadas a tu despliegue mixto)
// Para registrar el token FCM (Cloud Run Gen 2)
const API_URL_REGISTRO = 'https://registrarreceptor-6rmawrifca-uc.a.run.app';
// Para obtener el token de Twilio (Cloud Functions Gen 1)
const API_URL_TOKEN    = 'https://us-central1-puerta-c3a71.cloudfunctions.net/obtenerTokenTwilio';

// Variables Globales
let activeRoom = null;
let audioContext = null;
let ringtoneOscillator = null; 
let callTimeout = null;
let isMuted = false;
let wakeLock = null;
let keepaliveInterval = null;

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

/* --- EVENTO RESUME: Cuando vuelves a abrir la app manualmente --- */
document.addEventListener('resume', () => {
    log('☀️ APP EN PRIMER PLANO (Resume)');
    requestWakeLock();
    // Limpiamos notificaciones viejas de la barra para que no molesten
    if(window.Capacitor) PushNotifications.removeAllDeliveredNotifications();
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
        }
    } catch (err) { console.log(err); }
}

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !wakeLock) {
        await requestWakeLock();
    }
});

// ============================================
// INICIALIZACIÓN PRINCIPAL
// ============================================
window.iniciarApp = async function() {
    try {
        log('🚀 INICIANDO MONITOR V5 (Twilio + BgMode)...');
        
        // 1. AudioContext (Necesario click usuario primero para desbloquear audio)
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // 2. Limpieza UI (Quitar pantalla de bienvenida)
        const onboarding = document.getElementById('onboarding');
        if(onboarding) {
            onboarding.style.opacity = '0';
            setTimeout(() => onboarding.remove(), 500);
        }
        
        // 3. Iniciar Servicios
        await requestWakeLock();
        await iniciarCapacitor(); // Configura Push
        iniciarVisualizador();
        
        // 4. Activar Background Mode INMEDIATAMENTE
        activarModoSegundoPlano();

        // 5. Estado Inicial (Punto verde = Listo para recibir notificaciones)
        setStatus("✅ Listo para recibir llamadas");
        updateNetworkStatus('online');
        
    } catch (e) { 
        log('❌ ERROR FATAL: ' + e.message);
        alert("Error: " + e.message); 
    }
};

// ============================================
// MODO SEGUNDO PLANO (CRÍTICO PARA QUE NO DUERMA)
// ============================================
function activarModoSegundoPlano() {
    document.addEventListener('deviceready', () => {
        if (window.cordova && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
            const bg = window.cordova.plugins.backgroundMode;
            
            bg.enable(); // Habilitar permiso
            
            // Configuración agresiva para que Android no mate la app
            bg.setDefaults({
                title: "Monitor Puerta",
                text: "Esperando llamadas...",
                color: '#2ecc71',
                hidden: false, // Mostrar notificación fija es vital en Android modernos
                bigText: true,
                resume: true,
                silent: false
            });

            // Evita que el WebView se pause al apagar pantalla
            bg.on('activate', () => {
                bg.disableWebViewOptimizations(); 
                log('🔋 Background Mode: ACTIVO');
            });

            // Permiso para abrir desde background (Android 10+)
            if (bg.isScreenOff && bg.isScreenOff()) {
                bg.wakeUp();
                bg.unlock();
            }
        }
    }, false);
}

// ============================================
// GESTIÓN DE NOTIFICACIONES (CAPACITOR)
// ============================================
async function iniciarCapacitor() {
    if (!window.Capacitor) return;
    
    try {
        // Solicitar permisos
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
        
        if (perm.receive !== 'granted') {
            log('⚠️ Permisos Push DENEGADOS');
            return;
        }

        // Crear canal de Alta Prioridad (Sonido fuerte, vibración)
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

        // CASO 1: Llega la notificación (App abierta o cerrada)
        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            log('🔔 NOTIFICACIÓN RECIBIDA');
            
            // Forzamos sonido inmediato aunque no toquen nada
            startRinging();
            
            // Cambiamos UI
            setStatus("🔔 TIMBRE SONANDO");
            document.getElementById('avatar').innerText = "🔔";
            document.getElementById('controls-incoming').classList.remove('hidden');
            
            // Intentar traer al frente automágicamente (opcional, puede ser intrusivo)
            traerAlFrente();
        });

        // CASO 2: Usuario TOCA la notificación
        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
            log('👆 Usuario tocó notificación. ABRIENDO...');
            
            // 1. FORZAR LA APP AL FRENTE (SOLUCIÓN A TU PROBLEMA DE FOCO)
            traerAlFrente();

            // 2. Preparar UI por si acaso no estaba lista
            startRinging(); 
            setStatus("🔔 TIMBRE SONANDO");
            document.getElementById('controls-incoming').classList.remove('hidden');
        });

    } catch (e) {
        log('⚠️ Error Capacitor: ' + e.message);
    }
}

// Función auxiliar mágica para traer la app al frente
function traerAlFrente() {
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
        const bg = window.cordova.plugins.backgroundMode;
        
        // 1. Despertar la pantalla
        bg.wakeUp();
        // 2. Desbloquear (si no hay patrón seguro)
        bg.unlock();
        // 3. Mover la actividad al frente
        bg.moveToForeground();
        
        // Foco web standard
        window.focus();
        
        log('⚡ Trayendo app al frente...');
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
// LÓGICA DE LLAMADA TWILIO (CONTESTAR)
// ============================================
window.contestarLlamada = async function() {
    log('📞 CONTESTANDO...');
    stopRinging();

    try {
        // 1. Obtener Token (Usando URL correcta Gen 1)
        const res = await fetch(API_URL_TOKEN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identidad: 'Admin-' + Date.now(), sala: ROOM_NAME })
        });
        
        if(!res.ok) throw new Error('Error token: ' + res.status);
        const data = await res.json();

        // 2. Conectar Twilio
        activeRoom = await connect(data.token, {
            name: ROOM_NAME,
            audio: { echoCancellation: true, autoGainControl: true },
            video: false 
        });

        log(`✅ EN LLAMADA: ${activeRoom.name}`);
        
        // 3. UI Update
        document.getElementById('controls-incoming').classList.add('hidden');
        document.getElementById('controls-active').classList.remove('hidden');
        document.getElementById('btn-mute').style.display = 'flex'; 
        setStatus("🟢 EN LLAMADA");
        document.getElementById('avatar').innerText = "🔊";

        // 4. Gestión Audio
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
    log(`👤 Visitante: ${participant.identity}`);
    participant.on('trackSubscribed', track => {
        log('🔊 Audio recibido');
        // Conectar audio remoto
        document.getElementById('remoteAudio').srcObject = new MediaStream([track.mediaStreamTrack]);
        // Conectar visualizador
        conectarVisualizador(new MediaStream([track.mediaStreamTrack]));
    });
}

window.rechazarLlamada = function() {
    stopRinging();
    resetState();
    if(window.Capacitor) PushNotifications.removeAllDeliveredNotifications();
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
    document.getElementById('controls-incoming').classList.add('hidden');
    document.getElementById('controls-active').classList.add('hidden');
    document.getElementById('btn-mute').style.display = 'none';
    setStatus("✅ Listo para recibir llamadas");
    document.getElementById('avatar').innerText = "🔒";
}

// ============================================
// UTILIDADES (Audio, UI, Visualizador)
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
        if (!window.analyserNode) return; // Usamos variable global temporal
        
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
        window.analyserNode = audioContext.createAnalyser(); // Global para el loop
        window.analyserNode.fftSize = 2048;
        source.connect(window.analyserNode);
        const waveVis = document.getElementById('wave-visualizer');
        if(waveVis) waveVis.classList.add('active');
    } catch (e) {}
}
