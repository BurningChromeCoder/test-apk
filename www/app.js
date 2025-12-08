// www/app.js

const MY_ID = "puerta-admin-v2"; 
const API_URL = 'https://registrarreceptor-6rmawrifca-uc.a.run.app';

let peer = null;
let currentCall = null;
let currentDataConn = null;
let localStream = null;
let incomingCallRequest = null;
let audioContext = null;
let analyser = null;
let ringtoneOscillator = null; 
let callTimeout = null;
let isMuted = false;
let wakeLock = null;
let keepaliveInterval = null;
let keepaliveCount = 0;
let isCapacitorAvailable = false;
let PushNotifications = null;

// ============================================
// SISTEMA DE LOGS CON TIMESTAMPS
// ============================================
function log(msg) {
    const logDiv = document.getElementById('console-log');
    if(logDiv) {
        const time = new Date().toLocaleTimeString();
        logDiv.innerHTML = `<div>[${time}] ${msg}</div>` + logDiv.innerHTML;
    }
    console.log(`[App] ${msg}`);
}

// ============================================
// WAKE LOCK - Mantener pantalla activa
// ============================================
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            log('✅ Wake Lock ACTIVADO');
            
            wakeLock.addEventListener('release', () => {
                log('⚠️ Wake Lock liberado - re-adquiriendo...');
                setTimeout(requestWakeLock, 100);
            });
        } else {
            log('⚠️ Wake Lock NO soportado en este navegador');
        }
    } catch (err) {
        log('❌ Wake Lock error: ' + err.message);
    }
}

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLock === null) {
        await requestWakeLock();
    }
});

// ============================================
// KEEPALIVE AGRESIVO - CORREGIDO
// ============================================
function iniciarKeepalive() {
    if (keepaliveInterval) clearInterval(keepaliveInterval);
    
    keepaliveInterval = setInterval(() => {
        keepaliveCount++;
        const counterEl = document.getElementById('keepalive-count');
        if(counterEl) counterEl.innerText = keepaliveCount;
        
        // 1. Verificar si PeerJS cree que está desconectado
        if (peer && peer.disconnected) {
            log('🔄 PEER DESCONECTADO (Flag) - Reconectando...');
            peer.reconnect();
            return;
        }
        
        // 2. Intentar Ping al Socket (Buscamos en .socket o ._socket)
        // En PeerJS 1.5+ a veces el socket es interno (_socket)
        const socket = peer?.socket || peer?._socket;

        if (socket && socket.readyState === 1) { // 1 = OPEN
            try {
                socket.send(JSON.stringify({ type: 'PING' }));
                // No logueamos cada ping exitoso para no ensuciar la pantalla, solo si falla
            } catch (e) {
                log('⚠️ Error enviando Ping: ' + e.message);
            }
        } else {
            // Solo avisar si realmente perdimos conexión
            if(!peer || peer.destroyed) {
                log('⚠️ Socket perdido y Peer destruido.');
            } else {
                // Si el peer está vivo pero no encontramos el socket, es un detalle interno de la librería,
                // no es necesario spamear el log si el "Punto Verde" sigue activo.
                console.log('ℹ️ Socket no accesible para ping manual (pero Peer sigue online)');
            }
        }
        
        // 3. Verificar AudioContext no suspendido
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
            log('🔊 AudioContext resumido');
        }
        
    }, 15000); // Cada 15 segundos
}
// ============================================
// INICIALIZACIÓN PRINCIPAL
// ============================================
// Asignamos a window para que el botón "Entrar" del HTML lo encuentre
window.iniciarApp = async function() {
    try {
        log('🚀 INICIANDO SISTEMA ANTI-DELAY...');
        
        // 1. AudioContext
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        log('✅ AudioContext creado');
        
        // 2. Permisos de micrófono (liberar inmediatamente)
        const streamTemp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        streamTemp.getTracks().forEach(track => track.stop());
        log('✅ Permisos de audio concedidos');
        
        // 3. Ocultar onboarding
        const onboarding = document.getElementById('onboarding');
        if(onboarding) {
            onboarding.style.opacity = '0';
            setTimeout(() => onboarding.remove(), 500);
        }
        
        // 4. Wake Lock
        await requestWakeLock();
        
        // 5. Iniciar Capacitor si está disponible
        await iniciarCapacitor();
        
        // 6. Iniciar PeerJS
        iniciarPeer();
        
        // 7. Visualizador
        iniciarVisualizador();
        
        // 8. KEEPALIVE AGRESIVO (CRÍTICO)
        iniciarKeepalive();
        
        log('✅ SISTEMA COMPLETAMENTE INICIADO');
        
    } catch (e) { 
        log('❌ ERROR CRÍTICO: ' + e.message);
        alert("Error: " + e.message); 
    }
};

// ============================================
// CAPACITOR / FCM (Solo en Android)
// ============================================
async function iniciarCapacitor() {
    try {
        // Detectar si Capacitor está disponible
        if (window.Capacitor) {
            log('📱 Capacitor DETECTADO - Modo Android');
            isCapacitorAvailable = true;
            
            // Importar dinámicamente - AHORA VITE PODRÁ RESOLVERLO CORRECTAMENTE
            const module = await import('@capacitor/push-notifications');
            PushNotifications = module.PushNotifications;
            
            // Solicitar permisos
            let perm = await PushNotifications.checkPermissions();
            if (perm.receive === 'prompt') {
                perm = await PushNotifications.requestPermissions();
            }
            
            if (perm.receive !== 'granted') {
                log('⚠️ Permisos FCM DENEGADOS');
                return;
            }

            // Crear canal de alta prioridad
            await PushNotifications.createChannel({
                id: 'timbre_urgente',      
                name: 'Timbre de Puerta',
                importance: 5,
                visibility: 1,
                vibration: true,
                sound: 'default'
            });
            log('✅ Canal FCM creado');

            // Registrar
            await PushNotifications.register();
            log('✅ FCM Registro iniciado');
            
            // Listeners
            PushNotifications.addListener('registration', async (token) => {
                log('📲 Token FCM recibido');
                await registrarEnServidor(token.value);
            });

            PushNotifications.addListener('pushNotificationReceived', (notification) => {
                log('🔔 PUSH RECIBIDA EN FOREGROUND');
                console.log(notification);
            });

        } else {
            log('🌐 Modo WEB - FCM no disponible');
        }
    } catch (e) { 
        log('⚠️ Capacitor no disponible: ' + e.message);
    }
}

async function registrarEnServidor(token) {
    try {
        log('📡 Registrando token FCM en servidor...');
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, sala: 'puerta-principal' })
        });
        
        // Leemos la respuesta como texto primero para ver qué llega
        const text = await res.text();
        
        try {
            const data = JSON.parse(text);
            // Imprimimos todo el objeto data para ver qué responde el servidor
            log('✅ Respuesta Servidor: ' + JSON.stringify(data));
        } catch (e) {
            log('✅ Token enviado (Servidor respondió texto): ' + text);
        }
        
    } catch (e) {
        log('❌ Error registro token: ' + e.message);
    }
}

// ============================================
// CONFIGURACIÓN BACKGROUND MODE (AGREGAR ESTO)
// ============================================
document.addEventListener('deviceready', () => {
    // Verificamos si el plugin existe
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
        log('🔋 Detectado plugin Background Mode');
        
        // 1. Habilitar el modo
        window.cordova.plugins.backgroundMode.enable();
        
        // 2. Configuración de la notificación persistente
        window.cordova.plugins.backgroundMode.setDefaults({
            title: "Monitor Puerta Activo",
            text: "Sistema P2P en línea y esperando llamadas",
            icon: 'icon', // Usa el nombre de tu icono en res/drawable sin extensión
            color: '#2ecc71', // Color verde de tu app
            resume: true,
            hidden: false,
            bigText: true
        });

        // 3. Desactivar optimizaciones cuando se active el modo
        window.cordova.plugins.backgroundMode.on('activate', () => {
            window.cordova.plugins.backgroundMode.disableWebViewOptimizations(); 
            log('🔋 Background Mode ACTIVADO: Optimizaciones Webview deshabilitadas');
            
            // Opcional: Forzar reconexión si es necesario
            if (peer && peer.disconnected) peer.reconnect();
        });
        
    } else {
        log('⚠️ Cordova/Background plugin no detectado (¿Estás en web?)');
    }
}, false);
// ============================================
// PEERJS CON RECONEXIÓN INTELIGENTE
// ============================================
function iniciarPeer() {
    log('🔌 Iniciando PeerJS...');
    if (peer) {
        peer.destroy();
        log('♻️ Peer anterior destruido');
    }
    
    // Peer es global porque cargamos el script desde CDN en index.html
    peer = new Peer(MY_ID, {
        debug: 2,
        config: { 
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ] 
        },
        pingInterval: 5000 
    });

    peer.on('open', (id) => {
        log('✅ PeerJS CONECTADO: ' + id);
        updateNetworkStatus('online');
        setStatus("✅ Listo para recibir llamadas");
    });

    peer.on('connection', (conn) => {
        log('📨 Canal de datos establecido');
        currentDataConn = conn;
        
        conn.on('open', () => log('✅ Canal de datos ABIERTO'));
        
        conn.on('data', (data) => {
            log('📩 Dato recibido: ' + data);
            if (data === 'CORTAR') finalizarLlamada(false);
        });
        
        conn.on('close', () => {
            log('📪 Canal de datos cerrado');
        });
    });

    peer.on('call', (call) => {
        log('🔔🔔🔔 LLAMADA ENTRANTE de ' + call.peer);
        incomingCallRequest = call;
        
        setStatus("🔔 TIMBRE SONANDO");
        document.getElementById('avatar').innerText = "🔔";
        document.getElementById('controls-incoming').classList.remove('hidden');
        
        startRinging();
        if (navigator.vibrate) {
            navigator.vibrate([500, 200, 500, 200, 500, 200, 1000]);
        }
        
        if (callTimeout) clearTimeout(callTimeout);
        callTimeout = setTimeout(() => {
            log('⏱️ Timeout: Llamada no contestada');
            rechazarLlamada();
        }, 30000);
    });

    peer.on('error', (err) => {
        log('❌ PeerJS Error: ' + err.type + ' - ' + err.message);
        updateNetworkStatus('offline');
        
        if (err.type === 'unavailable-id') {
            alert("⚠️ Este ID ya está en uso. Cierra otras pestañas.");
        } else if (err.type === 'network' || err.type === 'server-error') {
            log('🔄 Error de red, reintentando en 3s...');
            setTimeout(iniciarPeer, 3000);
        }
    });

    peer.on('disconnected', () => { 
        log('⚠️ PeerJS DESCONECTADO');
        updateNetworkStatus('offline'); 
        setStatus("📡 Reconectando...");
        
        setTimeout(() => {
            if (peer && !peer.destroyed) {
                peer.reconnect();
            } else {
                iniciarPeer();
            }
        }, 2000);
    });

    peer.on('close', () => {
        log('🔴 Peer CERRADO completamente');
    });
}

// ============================================
// CONTESTAR LLAMADA
// ============================================
// Funciones globales para los botones HTML
window.contestarLlamada = async function() {
    if (!incomingCallRequest) {
        log('⚠️ No hay llamada entrante');
        return;
    }
    
    log('📞 CONTESTANDO LLAMADA...');
    stopRinging();
    if (callTimeout) clearTimeout(callTimeout);
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }, 
            video: false 
        });
        log('✅ Micrófono ACTIVADO');
        
        document.getElementById('controls-incoming').classList.add('hidden');
        document.getElementById('controls-active').classList.remove('hidden');
        document.getElementById('btn-mute').style.display = 'flex'; 
        setStatus("🟢 EN LLAMADA");
        document.getElementById('avatar').innerText = "🔊";
        
        currentCall = incomingCallRequest;
        currentCall.answer(localStream);
        log('✅ Respuesta enviada al visitante');
        
        currentCall.on('stream', (remoteStream) => {
            log('🔊 AUDIO REMOTO RECIBIDO');
            document.getElementById('remoteAudio').srcObject = remoteStream;
            conectarVisualizador(remoteStream);
        });
        
        currentCall.on('close', () => {
            log('📞 Llamada CERRADA por el otro lado');
            finalizarLlamada(false);
        });

        currentCall.on('error', (err) => {
            log('❌ Error en llamada: ' + err);
        });

    } catch (err) { 
        log('❌ Error al activar micrófono: ' + err.message);
        alert("Error de micrófono: " + err.message); 
        rechazarLlamada(); 
    }
};

window.rechazarLlamada = function() {
    log('❌ LLAMADA RECHAZADA');
    if (incomingCallRequest) incomingCallRequest.close();
    resetState();
};

window.finalizarLlamada = function(enviarAviso = true) {
    log('🔴 FINALIZANDO LLAMADA...');
    
    if (enviarAviso && currentDataConn && currentDataConn.open) {
        try {
            currentDataConn.send('CORTAR');
            log('📤 Señal CORTAR enviada');
        } catch (e) {
            log('⚠️ Error enviando CORTAR: ' + e.message);
        }
    }
    
    if (currentCall) currentCall.close();
    if (currentDataConn) currentDataConn.close();
    resetState();
};

function resetState() {
    stopRinging();
    if (callTimeout) clearTimeout(callTimeout);
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            log('🎤 Track de audio detenido');
        });
        localStream = null;
    }

    currentCall = null; 
    incomingCallRequest = null; 
    currentDataConn = null;
    
    document.getElementById('controls-incoming').classList.add('hidden');
    document.getElementById('controls-active').classList.add('hidden');
    document.getElementById('btn-mute').style.display = 'none';
    const waveVis = document.getElementById('wave-visualizer');
    if(waveVis) waveVis.classList.remove('active');
    
    setStatus("✅ Listo para recibir llamadas");
    document.getElementById('avatar').innerText = "🔒";
    updateNetworkStatus('online');
    log('✅ Estado RESETEADO');
}

// ============================================
// UTILIDADES
// ============================================
function startRinging() {
    if (!audioContext) return;
    try {
        ringtoneOscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        ringtoneOscillator.type = 'square';
        ringtoneOscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        ringtoneOscillator.connect(gain);
        gain.connect(audioContext.destination);
        gain.gain.value = 0.15;
        ringtoneOscillator.start();
        log('🔔 Timbre sonando');
    } catch (e) {
        log('⚠️ Error en timbre: ' + e.message);
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
    if (navigator.vibrate) navigator.vibrate(0);
}

window.toggleMute = function() {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    isMuted = !isMuted;
    track.enabled = !isMuted;
    document.getElementById('btn-mute').classList.toggle('muted', isMuted);
    log(isMuted ? '🔇 Micrófono MUTEADO' : '🔊 Micrófono ACTIVO');
};

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
        log('📊 Visualizador CONECTADO');
    } catch (e) {
        log('⚠️ Error visualizador: ' + e.message);
    }
}

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

window.addEventListener('beforeunload', () => {
    if (keepaliveInterval) clearInterval(keepaliveInterval);
    if (peer) peer.destroy();
});
