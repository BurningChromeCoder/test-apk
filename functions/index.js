const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Twilio = require('twilio');

admin.initializeApp();

// Configuración de Twilio (Asegúrate de tener estas variables en Firebase Config)
const TWILIO_ACCOUNT_SID = functions.config().twilio ? functions.config().twilio.sid : 'AC...';
const TWILIO_API_KEY = functions.config().twilio ? functions.config().twilio.key : 'SK...';
const TWILIO_API_SECRET = functions.config().twilio ? functions.config().twilio.secret : '...';

// Helper para CORS (Permite llamadas desde cualquier navegador)
const cors = (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return true; // Indica que se manejó la preflight request
    }
    return false;
};

// ==========================================
// 1. OBTENER TOKEN DE VIDEO (Para Twilio)
// ==========================================
exports.obtenerTokenTwilio = functions.https.onRequest((req, res) => {
    if (cors(req, res)) return;

    const { identidad, sala } = req.body; 

    if (!identidad || !sala) {
        return res.status(400).json({ error: 'Faltan parámetros: identidad o sala' });
    }

    try {
        const AccessToken = Twilio.jwt.AccessToken;
        const VideoGrant = AccessToken.VideoGrant;

        // Crear el token
        const token = new AccessToken(
            TWILIO_ACCOUNT_SID,
            TWILIO_API_KEY,
            TWILIO_API_SECRET,
            { identity: identidad }
        );

        // Dar permiso de Video
        const videoGrant = new VideoGrant({ room: sala });
        token.addGrant(videoGrant);

        // Devolver token
        return res.status(200).json({
            token: token.toJwt()
        });

    } catch (error) {
        console.error("❌ Error generando token:", error);
        return res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 2. NOTIFICAR LLAMADA (Inicia el proceso)
// ==========================================
exports.notificarLlamada = functions.https.onRequest(async (req, res) => {
    if (cors(req, res)) return;
    
    const { sala } = req.body;
    
    if (!sala) return res.status(400).json({ error: 'Falta parámetro: sala' });
    
    try {
        // A. Crear registro en Base de Datos
        const llamadaRef = admin.firestore().collection('llamadas').doc();
        const llamadaId = llamadaRef.id;

        const dbPromise = llamadaRef.set({
            sala: sala,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            estado: 'llamando', // Estado inicial
            sistema: 'v6-twilio'
        });

        // B. Enviar Notificación Push (Alta Prioridad)
        // Buscamos el token del receptor específico
        const receptorDoc = await admin.firestore().collection('receptores').doc('puerta-admin-v2').get();
        let fcmToken = null;
        if (receptorDoc.exists) {
            fcmToken = receptorDoc.data().fcmToken || receptorDoc.data().token;
        }

        const mensaje = {
            data: {
                type: 'incoming_call',
                sala: sala,
                llamadaId: llamadaId,
                callerName: 'Visitante en la Puerta',
                tipo: 'llamada'
            },
            android: {
                priority: 'high', 
                ttl: 30000, // 30 segundos de vida
            }
        };

        let fcmPromise;
        if (fcmToken) {
            // Envío directo al token (más confiable para despertar app cerrada)
            mensaje.token = fcmToken;
            fcmPromise = admin.messaging().send(mensaje);
        } else {
            // Envío por topic como respaldo
            mensaje.topic = sala;
            fcmPromise = admin.messaging().send(mensaje);
        }

        await Promise.all([dbPromise, fcmPromise]);
        
        return res.status(200).json({ 
            success: true,
            llamadaId: llamadaId,
            mensaje: 'Timbre enviado'
        });
        
    } catch (error) {
        console.error('❌ Error notificar:', error);
        return res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 3. REGISTRAR RECEPTOR (Vincula App con Casa)
// ==========================================
exports.registrarReceptor = functions.https.onRequest(async (req, res) => {
    if (cors(req, res)) return;
    
    const { token, sala } = req.body;
    
    if (!token || !sala) return res.status(400).json({ error: 'Faltan datos' });
    
    try {
        // Suscribir a Topic FCM
        await admin.messaging().subscribeToTopic(token, sala);
        
        // Guardar en DB (Usamos MY_ID: puerta-admin-v2 para consistencia con app.js)
        await admin.firestore().collection('receptores').doc('puerta-admin-v2').set({
            fcmToken: token,
            token: token,
            salas: admin.firestore.FieldValue.arrayUnion(sala),
            updated: admin.firestore.FieldValue.serverTimestamp(),
            platform: 'android'
        }, { merge: true });
        
        return res.status(200).json({ success: true, mensaje: 'Registrado' });
        
    } catch (error) {
        console.error('❌ Error registro:', error);
        return res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 4. RESPONDER LLAMADA (NUEVO V6 - Cost Saver)
// ==========================================
exports.responderLlamada = functions.https.onRequest(async (req, res) => {
    if (cors(req, res)) return;

    const { llamadaId } = req.body;

    if (!llamadaId) return res.status(400).send('Falta llamadaId');

    try {
        console.log(`✅ Llamada contestada: ${llamadaId}`);

        await admin.firestore().collection('llamadas').doc(llamadaId).update({
            estado: 'aceptada',
            contestadaEn: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('❌ Error respondiendo:', error);
        return res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 5. BUSCAR LLAMADA ACTIVA (Recuperación de fallos)
// ==========================================
exports.buscarLlamadaActiva = functions.https.onRequest(async (req, res) => {
    if (cors(req, res)) return;

    const { sala } = req.body;
    if (!sala) return res.status(400).send('Falta sala');

    try {
        const snapshot = await admin.firestore().collection('llamadas')
            .where('sala', '==', sala)
            .where('estado', '==', 'llamando')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(200).json({ activa: false });
        }

        const doc = snapshot.docs[0];
        const data = doc.data();
        
        const ahora = new Date();
        const fechaLlamada = data.timestamp.toDate();
        const diferenciaSegundos = (ahora - fechaLlamada) / 1000;

        if (diferenciaSegundos > 60) {
             return res.status(200).json({ activa: false, razon: 'expirada' });
        }

        return res.status(200).json({ 
            activa: true, 
            llamadaId: doc.id 
        });

    } catch (error) {
        console.error('Error buscando llamada:', error);
        return res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 6. TRIGGER AUTOMÁTICO (Para llamadas creadas directamente en Firestore)
// ==========================================
exports.onLlamadaCreada = functions.firestore
    .document('llamadas/{llamadaId}')
    .onCreate(async (snap, context) => {
        const data = snap.data();
        if (data.estado !== 'llamando') return null;

        try {
            const receptorDoc = await admin.firestore().collection('receptores').doc('puerta-admin-v2').get();
            if (!receptorDoc.exists || !receptorDoc.data().fcmToken) return null;

            const message = {
                token: receptorDoc.data().fcmToken,
                data: {
                    type: 'incoming_call',
                    llamadaId: context.params.llamadaId,
                    sala: data.sala || 'sala-principal',
                    callerName: 'Visitante'
                },
                android: { priority: 'high', ttl: 30000 }
            };
            return admin.messaging().send(message);
        } catch (error) {
            console.error('Error en trigger:', error);
            return null;
        }
    });
