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
// CONFIGURACIÓN (TUS ESPECIFICACIONES)
// ============================================
const MY_ID = "puerta-admin-v2"; 
const ROOM_NAME = 'sala-principal'; 

const API_URL_REGISTRO  = 'https://registrarreceptor-6rmawrifca-uc.a.run.app';
const API_URL_TOKEN     = 'https://us-central1-puerta-c3a71.cloudfunctions.net/obtenerTokenTwilio';

const MAX_REINTENTOS = 5; // 🔥 5 intentos
const REINTENTO_DELAY = 1000; // 🔥 1 segundo
const ICE_TIMEOUT = 10000;
const EMPTY_ROOM_TIMEOUT = 25000; // 🔥 25 segundos
const MAX_CALL_DURATION = 300000; // 🔥 5 minutos

// 🔥 MODO NO MOLESTAR: 20:00 - 8:00
const DO_NOT_DISTURB_START = 20; // 8 PM
const DO_NOT_DISTURB_END = 8; // 8 AM

let activeRoom = null;
let currentLlamadaId = null; 
let audioContext = null;
let ringtoneOscillator = null; 
let isMuted = false;
let wakeLock = null;
let firestoreUnsubscribe = null;
let reconexionIntentos = 0;
let iceTimeoutTimer = null;
let trackHealthCheck = null;
let currentBitrate = 40000;
let isReconnecting = false;
let audioBeepContext = null;
let emptyRoomTimeout = null;
let maxCallTimeout = null;

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

log('📄 app.js ejecutándose...');

// ============================================
// 🔊 SISTEMA DE BEEPS Y FEEDBACK
// ============================================
function inicializarAudioContext() {
    if (!audioBeepContext) {
        audioBeepContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// 🔥 VOLUMEN ADAPTATIVO SEGÚN RUIDO AMBIENTE
async function getAmbientVolume() {
    if (!audioBeepContext) return 0.7;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const analyser = audioBeepContext.createAnalyser();
        const source = audioBeepContext.createMediaStreamSource(stream);
        source.connect(analyser);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
        
        stream.getTracks().forEach(t => t.stop());
        
        if (avg > 50) {
            log('🔊 Ambiente ruidoso: volumen 0.9');
            return 0.9;
        }
        if (avg > 30) {
            log('🔊 Ambiente medio: volumen 0.7');
            return 0.7;
        }
        log('🔊 Ambiente silencioso: volumen 0.5');
        return 0.5;
        
    } catch (e) {
        return 0.7;
    }
}

function playBeep(frequency, duration, volume = 0.7) {
    inicializarAudioContext();
    if (audioBeepContext.state === 'suspended') {
        audioBeepContext.resume();
    }
    
    const oscillator = audioBeepContext.createOscillator();
    const gainNode = audioBeepContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioBeepContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gainNode.gain.value = volume;
    
    oscillator.start(audioBeepContext.currentTime);
    oscillator.stop(audioBeepContext.currentTime + duration / 1000);
    
    log(`🔊 Beep: ${frequency}Hz, vol: ${volume}`);
}

// 🔥 BEEP PRINCIPAL: 900Hz, 500ms, volumen adaptativo
async function playReadyBeep() {
    const volume = await getAmbientVolume();
    playBeep(900, 500, volume);
}

function playDoubleBeep() {
    playBeep(900, 150, 0.7);
    setTimeout(() => playBeep(900, 150, 0.7), 200);
}

function playWarningBeep() {
    playBeep(400, 200, 0.5);
}

// 🔥 VIBRACIÓN: Patrón medio [200, 100, 200]
function vibrar(pattern = [200, 100, 200]) {
    if ('vibrate' in navigator) {
        navigator.vibrate(pattern);
        log(`📳 Vibración: ${JSON.stringify(pattern)}`);
    }
}

function flashScreen(color, duration = 300) {
    const flash = document.createElement('div');
    flash.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: ${color};
        opacity: 0.3;
        z-index: 9999;
        pointer-events: none;
        animation: fadeOut ${duration}ms ease-out;
    `;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), duration);
}

const style = document.createElement('style');
style.textContent = `
    @keyframes fadeOut {
        0% { opacity: 0.3; }
        100% { opacity: 0; }
    }
`;
document.head.appendChild(style);

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
// 🔥 MODO NO MOLESTAR (20:00 - 8:00)
// ============================================
function estaEnModoNoMolestar() {
    const ahora = new Date();
    const hora = ahora.getHours();
    
    // Entre 20:00 y 23:59 O entre 00:00 y 7:59
    const enModoNoMolestar = hora >= DO_NOT_DISTURB_START || hora < DO_NOT_DISTURB_END;
    
    if (enModoNoMolestar) {
        log(`🌙 Modo No Molestar (${hora}:00 - Fuera de horario 8:00-20:00)`);
    }
    
    return enModoNoMolestar;
}

// ============================================
// 🔥 AJUSTE DINÁMICO DE BITRATE
// ============================================
function ajustarBitrate(newBitrate) {
    if (currentBitrate === newBitrate || !activeRoom) return;
    currentBitrate = newBitrate;
    
    activeRoom.localParticipant.audioTracks.forEach(publication => {
        const track = publication.track;
        if (track) {
            track.mediaStreamTrack.applyConstraints({
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: newBitrate < 30000 ? 16000 : 48000,
                channelCount: 1
            }).catch(e => log("⚠️ Error ajustando bitrate: " + e.message));
        }
    });
    
    log(`🔧 Bitrate ajustado a ${newBitrate/1000}kbps`);
}

// ============================================
// 🔥 INDICADOR DE CALIDAD DE RED
// ============================================
function actualizarIndicadorRed(quality) {
    const qualityMap = {
        5: '⚡ Excelente',
        4: '✅ Buena',
        3: '⚠️ Regular',
        2: '🔶 Débil',
        1: '❌ Mala',
        0: '❌ Sin señal'
    };
    
    updateNetworkStatus(quality >= 3 ? 'online' : 'offline', qualityMap[quality] || 'Desconocida');
    
    // 🔊 Beep + vibración si red muy mala
    if (quality <= 2) {
        playWarningBeep();
        vibrar([200]);
    }
    
    if (quality === 1) {
        ajustarBitrate(16000);
    } else if (quality === 2) {
        ajustarBitrate(24000);
    } else if (quality === 3) {
        ajustarBitrate(32000);
    } else {
        ajustarBitrate(40000);
    }
}

// ============================================
// 🔥 EVENTOS DE RECONEXIÓN
// ============================================
function configurarEventosReconexion(room) {
    room.on('reconnecting', (error) => {
        isReconnecting = true;
        log('🔄 Reconectando... (' + error.message + ')');
        setStatus("🔄 RECONECTANDO...");
        document.getElementById('avatar').innerText = "🔄";
        
        // 🔊 Vibración
        vibrar([200, 100, 200]);
    });

    room.on('reconnected', () => {
        isReconnecting = false;
        reconexionIntentos = 0;
        log('✅ Reconexión exitosa');
        setStatus("🟢 EN LLAMADA");
        document.getElementById('avatar').innerText = "🔊";
        
        // 🔊 Doble beep + vibración
        playDoubleBeep();
        vibrar([100, 50, 100, 50, 100]);
        flashScreen('#27ae60', 400);
    });

    room.on('disconnected', (room, error) => {
        log('❌ Desconectado: ' + (error ? error.message : 'Normal'));
        
        if (!error) {
            finalizarLlamada(false);
            return;
        }

        // 🔥 5 INTENTOS CON 1 SEGUNDO DE DELAY
        if (esErrorRecuperable(error) && reconexionIntentos < MAX_REINTENTOS) {
            reconexionIntentos++;
            log(`🔄 Intento ${reconexionIntentos}/${MAX_REINTENTOS}...`);
            setTimeout(() => intentarReconexion(), REINTENTO_DELAY);
        } else {
            setStatus("❌ Desconectado");
            // 🔥 RECARGAR PÁGINA
            setTimeout(() => location.reload(), 3000);
        }
    });

    room.on('participantConnected', p => participantConnected(p));
    room.on('participantDisconnected', participantDisconnected);
}

function esErrorRecuperable(error) {
    const recuperableCodes = [53000, 53001, 53405, 53407];
    return error && recuperableCodes.includes(error.code);
}

// ============================================
// 🔥 INTENTAR RECONEXIÓN COMPLETA
// ============================================
async function intentarReconexion() {
    try {
        log('🔄 Reconectando sala completa...');
        setStatus("🔄 RECONECTANDO...");
        
        if (activeRoom) {
            activeRoom.disconnect();
            activeRoom = null;
        }

        const res = await fetch(API_URL_TOKEN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identidad: 'Admin-' + Date.now(), sala: ROOM_NAME })
        });
        
        if(!res.ok) throw new Error('Error token: ' + res.status);
        const data = await res.json();

        activeRoom = await connect(data.token, {
            name: ROOM_NAME,
            audio: { 
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                googEchoCancellation: true,
                googAutoGainControl: true,
                googNoiseSuppression: true,
                googHighpassFilter: false,
                googTypingNoiseDetection: false
            },
            video: false,
            preferredAudioCodecs: ['opus'],
            maxAudioBitrate: 40000,
            networkQuality: { local: 1, remote: 1 },
            bandwidthProfile: {
                video: {
                    mode: 'collaboration',
                    dominantSpeakerPriority: 'high'
                }
            }
        });

        configurarEventosReconexion(activeRoom);
        activeRoom.participants.forEach(p => participantConnected(p));
        
        log('✅ Reconexión completa exitosa');
        setStatus("🟢 EN LLAMADA");
        
    } catch (e) {
        log('❌ Reconexión falló: ' + e.message);
        
        if (reconexionIntentos < MAX_REINTENTOS) {
            reconexionIntentos++;
            setTimeout(() => intentarReconexion(), REINTENTO_DELAY);
        } else {
            setStatus("❌ Sin conexión");
            setTimeout(() => location.reload(), 2000);
        }
    }
}

// ============================================
// 🔥 CHEQUEO DE SALUD DE TRACKS
// ============================================
function iniciarCheckeoTracks() {
    if (trackHealthCheck) clearInterval(trackHealthCheck);
    
    trackHealthCheck = setInterval(() => {
        if (!activeRoom || isReconnecting) return;
        
        let tracksOk = true;
        
        activeRoom.participants.forEach(participant => {
            participant.audioTracks.forEach(publication => {
                const track = publication.track;
                if (track && track.mediaStreamTrack.readyState !== 'live') {
                    log('⚠️ Track de audio muerto detectado');
                    tracksOk = false;
                }
            });
        });
        
        if (!tracksOk && !isReconnecting) {
            log('🔧 Reparando tracks...');
            activeRoom.participants.forEach(p => {
                p.tracks.forEach(pub => {
                    if (pub.track && pub.track.kind === 'audio') {
                        handleAudioTrack(pub.track, true);
                    }
                });
            });
        }
    }, 5000);
}

function detenerCheckeoTracks() {
    if (trackHealthCheck) {
        clearInterval(trackHealthCheck);
        trackHealthCheck = null;
    }
}

// ============================================
// 🔥 TIMEOUT ICE CONNECTION
// ============================================
function iniciarIceTimeout() {
    if (iceTimeoutTimer) clearTimeout(iceTimeoutTimer);
    
    iceTimeoutTimer = setTimeout(() => {
        if (activeRoom && activeRoom.state === 'connecting') {
            log('❌ ICE connection timeout');
            intentarReconexion();
        }
    }, ICE_TIMEOUT);
}

function detenerIceTimeout() {
    if (iceTimeoutTimer) {
        clearTimeout(iceTimeoutTimer);
        iceTimeoutTimer = null;
    }
}

// ============================================
// INICIALIZACIÓN
// ============================================
window.iniciarApp = async function() {
    try {
        log('🚀 INICIANDO V9.0 FINAL...');
        
        inicializarAudioContext();
        
        const requiredElements = ['console-log', 'status-text', 'avatar', 'controls-incoming', 'controls-active'];
        for (const id of requiredElements) {
            if (!document.getElementById(id)) {
                throw new Error(`Elemento ${id} no encontrado en el DOM`);
            }
        }
        log('✅ DOM verificado');
        
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            log('✅ Audio Context creado');
        } catch (e) {
            log('⚠️ Audio Context error: ' + e.message);
        }
        
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

        if (db) {
            log('🔥 Iniciando Firebase listener...');
            iniciarEscuchaFirebase();
            iniciarLimpiezaAutomatica();
        } else {
            throw new Error('Firebase no está disponible');
        }

        setStatus("✅ Listo para recibir llamadas");
        updateNetworkStatus('online', 'En Línea');
        log('✅ APP LISTA');
        
        // 🎛️ Cargar estado del toggle
        cargarEstadoModoForzado();
        
        // 🔥 TEST DE VIBRACIÓN
        setTimeout(() => {
            log('🧪 Probando vibración...');
            vibrar([200]);
            
            setTimeout(() => {
                const resultado = confirm('¿Sentiste la vibración?\n(Presiona OK si sí, Cancelar si no)');
                if (!resultado) {
                    log('⚠️ Vibración no funciona');
                    alert('⚠️ La vibración no funciona.\nVerifica permisos en:\nAjustes > Notificaciones > MiPuerta');
                } else {
                    log('✅ Vibración OK');
                }
            }, 1000);
        }, 1000);
        
    } catch (e) { 
        log('❌ ERROR CRÍTICO: ' + e.message);
        alert("Error inicialización: " + e.message);
        console.error(e);
    }
};

// ============================================
// FIREBASE LISTENER (CON MODO NO MOLESTAR)
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
                    
                    // 🔥 VERIFICAR MODO NO MOLESTAR
                    if (estaEnModoNoMolestar()) {
                        log(`🌙 Llamada bloqueada (Modo No Molestar)`);
                        
                        // Rechazar automáticamente
                        db.collection('llamadas').doc(id).delete()
                          .then(() => log('🗑️ Llamada rechazada (fuera de horario)'))
                          .catch(e => log('⚠️ Error: ' + e.message));
                        
                        // Mostrar notificación silenciosa
                        setStatus("🌙 Fuera de horario (20:00-8:00)");
                        setTimeout(() => setStatus("✅ Listo para recibir llamadas"), 3000);
                        
                        return; // No procesar la llamada
                    }
                    
                    log(`🚨 LLAMADA: ${id} (${data.estado})`);
                    
                    if (!activeRoom && !ringtoneOscillator) {
                        currentLlamadaId = id;
                        startRinging();
                        setStatus("🔔 TIMBRE SONANDO");
                        document.getElementById('avatar').innerText = "🔔";
                        document.getElementById('controls-incoming').classList.remove('hidden');
                        
                        // 🔊 Vibración
                        vibrar([200, 100, 200, 100, 200]);
                        
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
    log('🚀 Intentando traer app al frente...');
    
    if (window.cordova?.plugins?.backgroundMode) {
        const bg = window.cordova.plugins.backgroundMode;
        bg.wakeUp();
        bg.unlock();
        bg.moveToForeground();
        log('✅ Background mode: moveToForeground');
    }
    
    if (window.Capacitor) {
        try {
            window.dispatchEvent(new Event('focus'));
            window.focus();
            log('✅ Window focus triggered');
        } catch (e) {
            log('⚠️ Focus error: ' + e.message);
        }
    }
    
    requestWakeLock();
    
    vibrar([500, 200, 500, 200, 500]);
    
    if (audioBeepContext) {
        playBeep(800, 100, 0.7);
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
// 🔥 CONTESTAR (CON TODOS LOS TIMEOUTS)
// ============================================
window.contestarLlamada = async function() {
    log('📞 Contestando...');
    stopRinging();

    // 🔊 Vibración
    vibrar([200, 100, 200]);
    flashScreen('#2ecc71', 300);

    try {
        // Operaciones en paralelo
        const updatePromise = currentLlamadaId ? 
            db.collection('llamadas').doc(currentLlamadaId).update({ estado: 'aceptada' }) : 
            Promise.resolve();
        
        const tokenPromise = fetch(API_URL_TOKEN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identidad: 'Admin-' + Date.now(), sala: ROOM_NAME })
        });

        const [_, res] = await Promise.all([updatePromise, tokenPromise]);
        log('✅ Estado actualizado + Token obtenido');
        
        if(!res.ok) throw new Error('Error token: ' + res.status);
        const data = await res.json();

        iniciarIceTimeout();

        activeRoom = await connect(data.token, {
            name: ROOM_NAME,
            audio: { 
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                googEchoCancellation: true,
                googAutoGainControl: true,
                googNoiseSuppression: true,
                googHighpassFilter: false,
                googTypingNoiseDetection: false
            },
            video: false,
            preferredAudioCodecs: ['opus'],
            maxAudioBitrate: 40000,
            networkQuality: { local: 1, remote: 1 },
            bandwidthProfile: {
                video: {
                    mode: 'collaboration',
                    dominantSpeakerPriority: 'high'
                }
            }
        });

        log('✅ Twilio conectado');
        detenerIceTimeout();
        
        configurarEventosReconexion(activeRoom);
        iniciarCheckeoTracks();
        
        document.getElementById('controls-incoming').classList.add('hidden');
        document.getElementById('controls-active').classList.remove('hidden');
        document.getElementById('btn-mute').style.display = 'flex'; 
        setStatus("🟢 CONECTANDO...");
        document.getElementById('avatar').innerText = "🔊";

        // 🔥 TIMEOUT SALA VACÍA: 25 segundos
        emptyRoomTimeout = setTimeout(() => {
            if (activeRoom && activeRoom.participants.size === 0) {
                log('⚠️ Sala vacía por 25s, desconectando...');
                setStatus("❌ Visitante desconectado");
                alert('El visitante ya no está disponible');
                finalizarLlamada(true);
            }
        }, EMPTY_ROOM_TIMEOUT);

        activeRoom.participants.forEach(p => {
            clearTimeout(emptyRoomTimeout);
            emptyRoomTimeout = null;
            participantConnected(p);
        });
        
        // 🔥 TIMEOUT MÁXIMO DE LLAMADA: 5 minutos
        maxCallTimeout = setTimeout(() => {
            if (activeRoom) {
                log('⏱️ Tiempo máximo de llamada alcanzado (5 min)');
                setStatus("Tiempo agotado", "Llamada finalizada");
                alert('⏱️ Llamada finalizada por tiempo máximo (5 min)');
                finalizarLlamada(true);
            }
        }, MAX_CALL_DURATION);

    } catch (err) {
        log('❌ Error contestar: ' + err.message);
        alert('Error: ' + err.message);
        rechazarLlamada();
    }
};

// ============================================
// 🔥 PARTICIPANTES (CON AUTO-COLGAR)
// ============================================
function participantConnected(participant) {
    log(`👤 Participante: ${participant.identity}`);
    setStatus("🟢 EN LLAMADA");
    
    // Cancelar timeout sala vacía
    if (emptyRoomTimeout) {
        clearTimeout(emptyRoomTimeout);
        emptyRoomTimeout = null;
    }
    
    // 🔊 Vibración
    vibrar([200, 100, 200]);
    
    participant.tracks.forEach(publication => {
        if (publication.isSubscribed && publication.track.kind === 'audio') {
            handleAudioTrack(publication.track);
        }
    });
    
    participant.on('trackSubscribed', track => {
        if (track.kind === 'audio') {
            handleAudioTrack(track);
        }
    });
    
    // Monitorear calidad de red
    participant.on('networkQualityLevelChanged', (quality) => {
        actualizarIndicadorRed(quality);
        
        if (quality < 2) {
            log(`⚠️ Red muy débil: ${quality}/5`);
        }
    });
}

function participantDisconnected(participant) {
    log('👋 Participante desconectado: ' + participant.identity);
    
    // 🔥 AUTO-COLGAR CUANDO VISITANTE SE VA
    setStatus("Llamada finalizada", "El visitante colgó");
    
    // 🔊 Vibración
    vibrar([200]);
    
    setTimeout(() => {
        finalizarLlamada(true);
    }, 2000);
}

function handleAudioTrack(track, forcing = false) {
    const audioElement = document.getElementById('remoteAudio');
    audioElement.srcObject = new MediaStream([track.mediaStreamTrack]);
    
    audioElement.autoplay = true;
    audioElement.playsinline = true;
    
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    conectarVisualizador(new MediaStream([track.mediaStreamTrack]));
    
    if (forcing) {
        log('🔧 Track de audio reparado');
        playBeep(600, 100, 0.5);
        vibrar([100]);
    } else {
        log('🔊 Audio del visitante conectado');
        
        // 🔊🔊 BEEP PRINCIPAL: 900Hz, 500ms, volumen adaptativo
        playReadyBeep();
        vibrar([200, 100, 200]);
        flashScreen('#27ae60', 500);
        setStatus("🟢 EN LLAMADA");
        document.getElementById('status-text').innerText = "🟢 YA PUEDEN HABLAR";
    }
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
    
    detenerCheckeoTracks();
    detenerIceTimeout();
    
    // Limpiar timeouts
    if (emptyRoomTimeout) {
        clearTimeout(emptyRoomTimeout);
        emptyRoomTimeout = null;
    }
    if (maxCallTimeout) {
        clearTimeout(maxCallTimeout);
        maxCallTimeout = null;
    }
    
    if (window.stopVisualizer) window.stopVisualizer();
    
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
    reconexionIntentos = 0;
    isReconnecting = false;
    document.getElementById('controls-incoming').classList.add('hidden');
    document.getElementById('controls-active').classList.add('hidden');
    document.getElementById('btn-mute').style.display = 'none';
    setStatus("✅ Listo para recibir llamadas");
    document.getElementById('avatar').innerText = "🔒";
    updateNetworkStatus('online', 'En Línea');
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
    
    // 🔊 Vibración al mutear/desmutear
    vibrar([100]);
};

function setStatus(msg) { 
    const el = document.getElementById('status-text');
    if(el) el.innerText = msg; 
}

function updateNetworkStatus(status, text) {
    const dot = document.getElementById('net-dot');
    const txt = document.getElementById('net-text');
    if(dot) dot.className = 'dot ' + status;
    if(txt) txt.innerText = text || (status === 'online' ? 'En Línea' : 'Offline');
}

// ============================================
// VISUALIZADOR (OPTIMIZADO)
// ============================================
function iniciarVisualizador() {
    const canvas = document.getElementById('wave-visualizer');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; 
    canvas.height = 300;
    
    let animationId = null;
    
    function drawWave() {
        animationId = requestAnimationFrame(drawWave);
        if (!window.analyserNode) return; 
        
        const bufferLength = window.analyserNode.frequencyBinCount; 
        const dataArray = new Uint8Array(bufferLength);
        window.analyserNode.getByteTimeDomainData(dataArray);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 2; 
        ctx.strokeStyle = '#2ecc71'; 
        ctx.beginPath();
        
        const sliceWidth = canvas.width / (bufferLength / 2); 
        let x = 0;
        for (let i = 0; i < bufferLength; i += 2) {
            const v = dataArray[i] / 128.0; 
            const y = v * (canvas.height / 2);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); 
            x += sliceWidth;
        }
        ctx.lineTo(canvas.width, canvas.height / 2); 
        ctx.stroke();
    }
    drawWave();
    
    window.stopVisualizer = () => {
        if (animationId) cancelAnimationFrame(animationId);
    };
}

function conectarVisualizador(stream) {
    if (!audioContext) return;
    try {
        const source = audioContext.createMediaStreamSource(stream);
        window.analyserNode = audioContext.createAnalyser(); 
        
        window.analyserNode.fftSize = 512;
        window.analyserNode.smoothingTimeConstant = 0.8;
        
        source.connect(window.analyserNode);
        
        const waveVis = document.getElementById('wave-visualizer');
        if(waveVis) waveVis.classList.add('active');
    } catch (e) {
        log('⚠️ Error visualizador: ' + e.message);
    }
}

log('✅ Módulos cargados, esperando botón Entrar');

} // FIN initApp
