import { Haptics } from '@capacitor/haptics';
import { registerPlugin } from '@capacitor/core';

const WakeLock = registerPlugin('WakeLock');
const CallPlugin = registerPlugin('CallPlugin');

window.addEventListener('error', function(e) {
    const errorDiv = document.getElementById('console-log');
    if (errorDiv) {
        errorDiv.innerHTML = \`<div style="color:red;">❌ ERROR: \${e.message}<br>Archivo: \${e.filename}<br>Línea: \${e.lineno}</div>\` + errorDiv.innerHTML;
    }
    console.error('ERROR CAPTURADO:', e);
});

window.addEventListener('unhandledrejection', function(e) {
    const errorDiv = document.getElementById('console-log');
    if (errorDiv) {
        errorDiv.innerHTML = \`<div style="color:orange;">⚠️ PROMISE ERROR: \${e.reason}</div>\` + errorDiv.innerHTML;
    }
    console.error('PROMISE ERROR:', e);
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

async function initApp() {
    console.log('🚀 Iniciando carga de módulos...');

    let connect, PushNotifications;

    try {
        const twilioModule = await import('twilio-video');
        connect = twilioModule.connect;
        console.log('✅ Twilio cargado');
    } catch (e) {
        console.error('Error cargando Twilio:', e);
    }

    try {
        const capacitorModule = await import('@capacitor/push-notifications');
        PushNotifications = capacitorModule.PushNotifications;
        console.log('✅ Capacitor cargado');
    } catch (e) {
        console.log('⚠️ Capacitor no disponible');
    }

    let db;
    try {
        if (typeof firebase !== 'undefined') {
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
        }
    } catch (e) {
        console.error('Firebase error:', e);
    }

    const ROOM_NAME = 'sala-principal'; 
    const API_URL_REGISTRO = 'https://registrarreceptor-6rmawrifca-uc.a.run.app';
    const API_URL_TOKEN = 'https://us-central1-puerta-c3a71.cloudfunctions.net/obtenerTokenTwilio';
    
    let activeRoom = null;
    let currentLlamadaId = null; 
    let audioContext = null;
    let ringtoneOscillator = null; 
    let isMuted = false;
    let wakeLock = null;
    let firestoreUnsubscribe = null;
    let isProcessingCall = false;
    let lastCallTimestamp = 0;

    if (window.Capacitor) {
        CallPlugin.addListener('callStateChanged', (data) => {
            log('📞 Estado llamada nativa: ' + data.action);
            if (data.action === 'answered') contestarLlamada();
            else if (data.action === 'rejected') rechazarLlamada();
        });
    }

    function log(msg) {
        const logDiv = document.getElementById('console-log');
        if(logDiv) {
            const time = new Date().toLocaleTimeString();
            logDiv.innerHTML = \`<div>[\${time}] \${msg}</div>\` + logDiv.innerHTML;
        }
        console.log(\`[App] \${msg}\`);
    }

    async function vibrar(pattern = [200, 100, 200]) {
        try {
            if (window.Capacitor) {
                await CallPlugin.vibrate(); 
                return;
            }
        } catch (e) {}
        if ('vibrate' in navigator) navigator.vibrate(pattern);
    }

    async function requestWakeLock() {
        if (window.Capacitor) {
            try { await WakeLock.acquire(); } catch (err) {}
        }
    }

    window.iniciarApp = async function() {
        try {
            log('🚀 INICIANDO V12.0...');
            const onboarding = document.getElementById('onboarding');
            if(onboarding) {
                onboarding.style.opacity = '0';
                setTimeout(() => onboarding.remove(), 500);
            }
            await requestWakeLock();
            if (window.Capacitor) {
                try { await CallPlugin.requestPermissions(); } catch (e) {}
                await iniciarCapacitor();
            }
            iniciarVisualizador();
            if (db) {
                iniciarEscuchaFirebase();
            }
            setStatus("✅ Listo para recibir llamadas");
            window.cargarConfiguracionRingtone();
        } catch (e) { 
            log('❌ ERROR: ' + e.message);
        }
    };

    function iniciarEscuchaFirebase() {
        if (firestoreUnsubscribe) firestoreUnsubscribe();
        const query = db.collection('llamadas');
        firestoreUnsubscribe = query.onSnapshot((snapshot) => {
            log(\`🔔 Firebase: \${snapshot.size} docs\`);
            snapshot.docChanges().forEach((change) => {
                const data = change.doc.data();
                const id = change.doc.id;
                if (data.sala === ROOM_NAME && (data.estado === 'pendiente' || data.estado === 'llamando')) {
                    if (currentLlamadaId !== id) {
                        currentLlamadaId = id;
                        log(\`🚨 LLAMADA: \${id}\`);
                        startRinging();
                        traerAlFrente();
                    }
                }
            });
        });
    }

    async function iniciarCapacitor() {
        if (!PushNotifications) return;
        try {
            let perm = await PushNotifications.requestPermissions();
            if (perm.receive === 'granted') {
                await PushNotifications.register();
                PushNotifications.addListener('registration', (token) => registrarEnServidor(token.value));
                PushNotifications.addListener('pushNotificationReceived', () => traerAlFrente());
            }
        } catch (e) {}
    }

    async function traerAlFrente() {
        const now = Date.now();
        if (isProcessingCall && (now - lastCallTimestamp) < 5000) return;
        isProcessingCall = true;
        lastCallTimestamp = now;
        const ringtoneType = localStorage.getItem('selected_ringtone') || 'TYPE_RINGTONE';
        if (window.Capacitor) {
            try {
                await CallPlugin.showIncomingCall({ ringtoneType: ringtoneType });
                log('✅ LLAMADA NATIVA ACTIVADA');
            } catch (e) { log('⚠️ Error Plugin: ' + e.message); }
        }
        vibrar([500, 200, 500]);
        setTimeout(() => { isProcessingCall = false; }, 5000);
    }

    async function registrarEnServidor(token) {
        try {
            await fetch(API_URL_REGISTRO, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, sala: ROOM_NAME })
            });
        } catch (e) {}
    }

    window.contestarLlamada = async function() {
        log('📞 Contestando...');
        stopRinging();
        try {
            if (currentLlamadaId) await db.collection('llamadas').doc(currentLlamadaId).update({ estado: 'aceptada' });
            const res = await fetch(API_URL_TOKEN, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identidad: 'Admin-' + Date.now(), sala: ROOM_NAME })
            });
            const data = await res.json();
            activeRoom = await connect(data.token, { name: ROOM_NAME, audio: true, video: false });
            activeRoom.on('participantConnected', p => participantConnected(p));
            activeRoom.on('disconnected', () => finalizarLlamada());
            setStatus("🟢 EN LLAMADA");
            document.getElementById('controls-incoming').classList.add('hidden');
            document.getElementById('controls-active').classList.remove('hidden');
        } catch (e) { log('❌ Error: ' + e.message); }
    };

    window.rechazarLlamada = async function() {
        log('❌ Rechazando...');
        stopRinging();
        if (currentLlamadaId) await db.collection('llamadas').doc(currentLlamadaId).update({ estado: 'rechazada' });
        finalizarLlamada();
    };

    window.finalizarLlamada = function() {
        if (activeRoom) activeRoom.disconnect();
        activeRoom = null;
        currentLlamadaId = null;
        stopRinging();
        if (window.Capacitor) CallPlugin.endCall();
        setStatus("✅ Listo");
        document.getElementById('controls-incoming').classList.add('hidden');
        document.getElementById('controls-active').classList.add('hidden');
    };

    function startRinging() {
        document.getElementById('controls-incoming').classList.remove('hidden');
        setStatus("🔔 TIMBRE SONANDO");
    }

    function stopRinging() {
        if (window.Capacitor) CallPlugin.endCall();
    }

    function participantConnected(participant) {
        log(\`👤 Conectado: \${participant.identity}\`);
        participant.on('trackSubscribed', track => {
            if (track.kind === 'audio') {
                const el = track.attach();
                document.body.appendChild(el);
            }
        });
    }

    function setStatus(msg) { 
        const el = document.getElementById('status-text');
        if(el) el.innerText = msg; 
    }

    function iniciarVisualizador() {
        const canvas = document.getElementById('wave-visualizer');
        if(!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth; 
        canvas.height = 300;
        function draw() {
            requestAnimationFrame(draw);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        draw();
    }

    window.cambiarRingtone = function(val) {
        localStorage.setItem('selected_ringtone', val);
        log('🎵 Tono: ' + val);
    };

    window.cargarConfiguracionRingtone = function() {
        const guardado = localStorage.getItem('selected_ringtone') || 'TYPE_RINGTONE';
        const select = document.getElementById('ringtone-type');
        if (select) select.value = guardado;
    };
}
