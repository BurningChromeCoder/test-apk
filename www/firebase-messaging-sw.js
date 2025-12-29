importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// TU CONFIGURACIÓN EXACTA
firebase.initializeApp({
  apiKey: "AIzaSyBxOnEz1YAtlAYsQVHmLJJZ0L37H2FoeRE",
  authDomain: "puerta-c3a71.firebaseapp.com",
  projectId: "puerta-c3a71",
  storageBucket: "puerta-c3a71.firebasestorage.app",
  messagingSenderId: "830550601352",
  appId: "1:830550601352:android:11418db7ac30773d4db93d"
});

const messaging = firebase.messaging();

// Manejo de mensajes cuando la web está en segundo plano (PC/Navegador móvil)
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Notificación recibida:', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/assets/icon.png',
    data: payload.data,
    requireInteraction: true, // Mantiene la notificación visible hasta que el usuario interactúa
    actions: [
        {action: 'open', title: '📞 Contestar'}
    ]
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Manejo del CLICK en la notificación
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    // Apuntamos a la raíz (index.html) donde está la lógica de contestar
    const urlToOpen = new URL('/', self.location.origin).href;
    
    event.waitUntil(
        clients.matchAll({type: 'window', includeUncontrolled: true}).then(windowClients => {
            // 1. Si la app ya está abierta, la ponemos en primer plano
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                // Verificamos si la URL coincide con nuestra app
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            // 2. Si no estaba abierta, la abrimos nueva
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
