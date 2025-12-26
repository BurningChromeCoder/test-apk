const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require('firebase-admin');
const Twilio = require('twilio');

admin.initializeApp();

// Configurar región por defecto (opcional, ajusta según tu preferencia)
setGlobalOptions({ region: 'us-central1' });

// Configuración de Twilio
// Nota: En v2 se recomienda usar secretos o variables de entorno de GCP
// Para mantener compatibilidad rápida, intentamos obtener de config() o variables de entorno
const TWILIO_ACCOUNT_SID = process.env.TWILIO_SID || 'AC...';
const TWILIO_API_KEY = process.env.TWILIO_KEY || 'SK...';
const TWILIO_API_SECRET = process.env.TWILIO_SECRET || '...';

// Helper para CORS
const handleCors = (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return true;
    }
    return false;
};

// 1. OBTENER TOKEN DE VIDEO
exports.obtenerTokenTwilio = onRequest(async (req, res) => {
    if (handleCors(req, res)) return;

    const { identidad, sala } = req.body; 
    if (!identidad || !sala) {
        return res.status(400).json({ error: 'Faltan parámetros' });
    }

    try {
        const AccessToken = Twilio.jwt.AccessToken;
        const VideoGrant = AccessToken.VideoGrant;
        const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, { identity: identidad });
        token.addGrant(new VideoGrant({ room: sala }));
        return res.status(200).json({ token: token.toJwt() });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// 2. NOTIFICAR LLAMADA
exports.notificarLlamada = onRequest(async (req, res) => {
    if (handleCors(req, res)) return;
    
    const { sala } = req.body;
    if (!sala) return res.status(400).json({ error: 'Falta sala' });
    
    try {
        const llamadaRef = admin.firestore().collection('llamadas').doc();
        const llamadaId = llamadaRef.id;

        await llamadaRef.set({
            sala: sala,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            estado: 'llamando',
            sistema: 'v6-twilio'
        });

        const receptorDoc = await admin.firestore().collection('receptores').doc('puerta-admin-v2').get();
        let fcmToken = receptorDoc.exists ? (receptorDoc.data().fcmToken || receptorDoc.data().token) : null;

        const mensaje = {
            data: {
                type: 'incoming_call',
                sala: sala,
                llamadaId: llamadaId,
                callerName: 'Visitante',
                tipo: 'llamada'
            },
            android: { priority: 'high', ttl: 30000 }
        };

        if (fcmToken) {
            mensaje.token = fcmToken;
        } else {
            mensaje.topic = sala;
        }

        await admin.messaging().send(mensaje);
        return res.status(200).json({ success: true, llamadaId: llamadaId });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// 3. REGISTRAR RECEPTOR
exports.registrarReceptor = onRequest(async (req, res) => {
    if (handleCors(req, res)) return;
    const { token, sala } = req.body;
    if (!token || !sala) return res.status(400).json({ error: 'Faltan datos' });
    
    try {
        await admin.messaging().subscribeToTopic(token, sala);
        await admin.firestore().collection('receptores').doc('puerta-admin-v2').set({
            fcmToken: token,
            token: token,
            salas: admin.firestore.FieldValue.arrayUnion(sala),
            updated: admin.firestore.FieldValue.serverTimestamp(),
            platform: 'android'
        }, { merge: true });
        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// 4. RESPONDER LLAMADA
exports.responderLlamada = onRequest(async (req, res) => {
    if (handleCors(req, res)) return;
    const { llamadaId } = req.body;
    if (!llamadaId) return res.status(400).send('Falta llamadaId');
    try {
        await admin.firestore().collection('llamadas').doc(llamadaId).update({
            estado: 'aceptada',
            contestadaEn: admin.firestore.FieldValue.serverTimestamp()
        });
        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// 5. BUSCAR LLAMADA ACTIVA
exports.buscarLlamadaActiva = onRequest(async (req, res) => {
    if (handleCors(req, res)) return;
    const { sala } = req.body;
    if (!sala) return res.status(400).send('Falta sala');
    try {
        const snapshot = await admin.firestore().collection('llamadas')
            .where('sala', '==', sala)
            .where('estado', '==', 'llamando')
            .orderBy('timestamp', 'desc').limit(1).get();

        if (snapshot.empty) return res.status(200).json({ activa: false });
        const doc = snapshot.docs[0];
        const data = doc.data();
        const diferenciaSegundos = (new Date() - data.timestamp.toDate()) / 1000;
        if (diferenciaSegundos > 60) return res.status(200).json({ activa: false });
        return res.status(200).json({ activa: true, llamadaId: doc.id });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// 6. TRIGGER AUTOMÁTICO (Sintaxis v2)
exports.onLlamadaCreada = onDocumentCreated("llamadas/{llamadaId}", async (event) => {
    const data = event.data.data();
    if (!data || data.estado !== 'llamando') return;

    try {
        const receptorDoc = await admin.firestore().collection('receptores').doc('puerta-admin-v2').get();
        if (!receptorDoc.exists || !receptorDoc.data().fcmToken) return;

        await admin.messaging().send({
            token: receptorDoc.data().fcmToken,
            data: {
                type: 'incoming_call',
                llamadaId: event.params.llamadaId,
                sala: data.sala || 'sala-principal',
                callerName: 'Visitante'
            },
            android: { priority: 'high', ttl: 30000 }
        });
    } catch (error) {
        console.error('Error en trigger:', error);
    }
});
