// ============================================
// CAPTURA DE ERRORES GLOBAL
// ============================================
window.addEventListener('error', function(e) {
    const errorDiv = document.getElementById('console-log');
    if (errorDiv) {
        errorDiv.innerHTML = `<div style="color:red;">❌ ERROR: ${e.message}<br>Archivo: ${e.filename}<br>Línea: ${e.lineno}</div>` + errorDiv.innerHTML;
    }
    console.error('ERROR CAPTURADO:', e);
    alert('ERROR: ' + e.message + '\nVer consola en pantalla');
});

window.addEventListener('unhandledrejection', function(e) {
    const errorDiv = document.getElementById('console-log');
    if (errorDiv) {
        errorDiv.innerHTML = `<div style="color:orange;">⚠️ PROMISE ERROR: ${e.reason}</div>` + errorDiv.innerHTML;
    }
    console.error('PROMISE ERROR:', e);
});

// ============================================
// ESPERAR A QUE EL DOM ESTÉ LISTO
// ============================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

async function initApp() {
    console.log('🚀 Iniciando carga de módulos...');

// ============================================
// IMPORTACIONES CON TRY-CATCH
// ============================================
let connect, PushNotifications;

try {
    const twilioModule = await import('twilio-video');
    connect = twilioModule.connect;
    console.log('✅ Twilio cargado');
} catch (e) {
    console.error('Error cargando Twilio:', e);
    alert('Error cargando Twilio: ' + e.message);
}

try {
    const capacitorModule = await import('@capacitor/push-notifications');
    PushNotifications = capacitorModule.PushNotifications;
    console.log('✅ Capacitor cargado');
} catch (e) {
    console.log('⚠️ Capacitor no disponible (normal en web)');
}

// ============================================
// FIREBASE CON TRY-CATCH
// ============================================
let db;
try {
    // Verificar si firebase ya está cargado globalmente
    if (typeof firebase !== 'undefined') {
        console.log('✅ Firebase global detectado');
        if (!firebase.apps.length) {
            firebase.initializeApp({
                apiKey: "AIzaSyDMxrgcvTwO54m6NZjIGLTIGjKLYYYqF0E",
                authDomain: "puerta-c3a71.firebaseapp.com",
                projectId: "puerta-c3a71",
                storageBucket: "puerta-c3a71.firebasestorage.app",
                messagingSenderId: "830550601352",
                appId: "1:830550601352:web:f7125f76a1256aeb4db93d"
            });
        }
        db = firebase.firestore();
        console.log('✅ Firebase inicializado');
    } else {
        throw new Error('Firebase no está disponible globalmente');
    }
} catch (e) {
    alert('ERROR FIREBASE: ' + e.message);
    console.error('Firebase error:', e);
}

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
// LOGS VISIBLES
// ============================================
function log(msg) {
    const logDiv = document.getElementById('console-log');
    if(logDiv) {
        const time = new Date().toLocaleTimeString();
        logDiv.innerHTML = `<div>[${time}] ${msg}</div>` + logDiv.innerHTML;
    }
    console.log(`[App] ${msg}`);
}

// Primer log para verificar que el script se carga
log('📄 app.js ejecutándose...');

/* --- EVENTO RESUME --- */
document.addEventListener('resume', () => {
    log('☀️ APP EN PRIMER PLANO');
    requestWakeLock();
    if(window.Capacitor && PushNotifications) PushNotifications.removeAllDeliveredNotifications();
}, false);

// ============================================
// WAKE LOCK
// ============================================
async function requestWakeLock() {
    if (document.visibilityState !== 'visible') return;
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            log('🔒 Wake Lock activado');
        }
    } catch (err) {
        log('⚠️ Wake Lock no disponible');
    }
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
        log('🚀 INICIANDO V7.2 DEBUG...');
        
        // Verificar elementos del DOM
        const requiredElements = ['console-log', 'status-text', 'avatar', 'controls-incoming', 'controls-active'];
        for (const id of requiredElements) {
            if (!document.getElementById(id)) {
                throw new Error(`Elemento ${id} no encontrado en el DOM`);
            }
        }
        log('✅ DOM verificado');
        
        // Audio Context
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            log('✅ Audio Context creado');
        } catch (e) {
            log('⚠️ Audio Context error: ' + e.message);
        }
        
        // Remover onboarding
        const onboarding = document.getElementById('onboarding');
        if(onboarding) {
            onboarding.style.opacity = '0';
            setTimeout(() => onboarding.remove(), 500);
            log('✅ Onboarding removido');
        }
        
        await requestWakeLock();
        
        if (window.Capacitor) {
            log('📱 Modo Capacitor detectado');
            await iniciarCapacitor();
        } else {
            log('🌐 Modo Web detectado');
        }
        
        iniciarVisualizador();
        activarModoSegundoPlano();

        // Firebase
        if (db) {
            log('🔥 Iniciando Firebase listener...');
            iniciarEscuchaFirebase();
            iniciarLimpiezaAutomatica();
        } else {
            throw new Error('Firebase no está disponible');
        }

        setStatus("✅ Listo para recibir llamadas");
        updateNetworkStatus('online');
        log('✅ APP LISTA');
        
    } catch (e) { 
        log('❌ ERROR CRÍTICO: ' + e.message);
        alert("Error inicialización: " + e.message);
        console.error(e);
    }
};

// ============================================
// FIREBASE LISTENER
// ============================================
function iniciarEscuchaFirebase() {
    try {
        log('👂 Configurando listener Firebase...');
        
        if (firestoreUnsubscribe) {
            firestoreUnsubscribe();
        }
        
        const query = db.collection('llamadas').where('sala', '==', ROOM_NAME);
        
        firestoreUnsubscribe = query.onSnapshot((snapshot) => {
            log(`🔔 Firebase: ${snapshot.size} llamada(s)`);
            
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' || change.type === 'modified') {
                    const data = change.doc.data();
                    const id = change.doc.id;
                    
                    if (data.estado !== 'pendiente' && data.estado !== 'llamando') {
                        return;
                    }
                    
                    log(`🚨 LLAMADA: ${id} (${data.estado})`);
                    
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
            log('❌ Error Firebase listener: ' + error.message);
        });
        
        log('✅ Listener Firebase activo');
    } catch (e) {
        log('❌ Error configurando listener: ' + e.message);
    }
}

// ============================================
// LIMPIEZA
// ============================================
function iniciarLimpiezaAutomatica() {
    log('🧹 Sistema limpieza activado');
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
            log('✅ BD limpia');
            return;
        }
        
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        log(`🗑️ ${snapshot.size} llamada(s) eliminada(s)`);
    } catch (error) {
        log('⚠️ Error limpieza: ' + error.message);
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
            log('✅ Background mode activado');
        }
    }, false);
}

// ============================================
// NOTIFICACIONES
// ============================================
async function iniciarCapacitor() {
    if (!PushNotifications) {
        log('⚠️ PushNotifications no disponible');
        return;
    }
    
    try {
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt') {
            perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== 'granted') {
            log('⚠️ Permisos push denegados');
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
        log('✅ Push notifications registradas');

        PushNotifications.addListener('registration', async (token) => {
            log('📲 Token: ' + token.value.substring(0, 20) + '...');
            await registrarEnServidor(token.value);
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            log('🔔 Push recibida');
            traerAlFrente();
        });

    } catch (e) { 
        log('❌ Error Push: ' + e.message); 
    }
}

function traerAlFrente() {
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
        window.cordova.plugins.backgroundMode.wakeUp();
        window.cordova.plugins.backgroundMode.unlock();
        window.cordova.plugins.backgroundMode.moveToForeground();
    }
}

async function registrarEnServidor(token) {
    try {
        await fetch(API_URL_REGISTRO, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, sala: ROOM_NAME })
        });
        log('✅ Token registrado');
    } catch (e) {
        log('⚠️ Error registro token');
    }
}

// ============================================
// CONTESTAR
// ============================================
window.contestarLlamada = async function() {
    log('📞 Contestando...');
    stopRinging();

    try {
        if (currentLlamadaId) {
            await db.collection('llamadas').doc(currentLlamadaId).update({
                estado: 'aceptada'
            });
            log('✅ Estado actualizado');
        }

        const res = await fetch(API_URL_TOKEN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identidad: 'Admin-' + Date.now(), sala: ROOM_NAME })
        });
        
        if(!res.ok) throw new Error('Error token: ' + res.status);
        const data = await res.json();
        log('✅ Token obtenido');

        activeRoom = await connect(data.token, {
            name: ROOM_NAME,
            audio: { echoCancellation: true, autoGainControl: true },
            video: false 
        });

        log('✅ Twilio conectado');
        
        document.getElementById('controls-incoming').classList.add('hidden');
        document.getElementById('controls-active').classList.remove('hidden');
        document.getElementById('btn-mute').style.display = 'flex'; 
        setStatus("🟢 EN LLAMADA");
        document.getElementById('avatar').innerText = "🔊";

        activeRoom.participants.forEach(p => participantConnected(p));
        activeRoom.on('participantConnected', p => participantConnected(p));
        activeRoom.on('disconnected', () => finalizarLlamada(false));

    } catch (err) {
        log('❌ Error contestar: ' + err.message);
        alert('Error: ' + err.message);
        rechazarLlamada();
    }
};

function participantConnected(participant) {
    log(`👤 Participante: ${participant.identity}`);
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
            log('🗑️ Llamada eliminada');
        } catch (error) {
            log('⚠️ Error eliminando: ' + error.message);
        }
    }
    
    resetState();
    if(window.Capacitor && PushNotifications) PushNotifications.removeAllDeliveredNotifications();
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
            log('🗑️ Llamada finalizada');
        } catch (error) {
            log('⚠️ Error: ' + error.message);
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
// AUDIO
// ============================================
function startRinging() {
    if (!audioContext) {
        log('⚠️ No hay AudioContext');
        return;
    }
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
        log('🔔 Timbre activado');
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
    log(isMuted ? '🔇 Mute ON' : '🔊 Mute OFF');
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
    } catch (e) {
        log('⚠️ Error visualizador: ' + e.message);
    }
}

log('✅ Módulos cargados, esperando botón Entrar');

} // FIN initApp
