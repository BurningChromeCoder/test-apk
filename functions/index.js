const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.enviarNotificacionLlamada = functions.firestore
    .document('llamadas/{llamadaId}')
    .onCreate(async (snap, context) => {
        const llamadaId = context.params.llamadaId;
        const llamadaData = snap.data();
        if (llamadaData.estado !== 'pendiente' && llamadaData.estado !== 'llamando') return null;
        try {
            const receptorDoc = await admin.firestore().collection('receptores').doc('puerta-admin-v2').get();
            if (!receptorDoc.exists) return null;
            const fcmToken = receptorDoc.data().fcmToken;
            if (!fcmToken) return null;
            const message = {
                token: fcmToken,
                data: {
                    type: 'incoming_call',
                    llamadaId: llamadaId,
                    callerName: llamadaData.visitante || 'Visitante',
                    sala: llamadaData.sala || 'sala-principal'
                },
                android: { priority: 'high', ttl: 30000 }
            };
            return admin.messaging().send(message);
        } catch (error) {
            console.error('Error FCM:', error);
            return null;
        }
    });

exports.actualizarEstadoLlamada = functions.firestore
    .document('llamadas/{llamadaId}')
    .onUpdate(async (change, context) => {
        const despues = change.after.data();
        if (despues.estado === 'contestada' || despues.estado === 'rechazada') {
            const receptorDoc = await admin.firestore().collection('receptores').doc('puerta-admin-v2').get();
            if (receptorDoc.exists && receptorDoc.data().fcmToken) {
                return admin.messaging().send({
                    token: receptorDoc.data().fcmToken,
                    data: { type: 'end_call', llamadaId: context.params.llamadaId }
                });
            }
        }
        return null;
    });
