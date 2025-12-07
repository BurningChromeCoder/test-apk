importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// TU CONFIGURACIÓN EXACTA
firebase.initializeApp({
  apiKey: "AIzaSyDMxrgcvTwO54m6NZjIGLTIGjKLYYYqF0E",
  authDomain: "puerta-c3a71.firebaseapp.com",
  projectId: "puerta-c3a71",
  storageBucket: "puerta-c3a71.firebasestorage.app",
  messagingSenderId: "830550601352",
  appId: "1:830550601352:web:f7125f76a1256aeb4db93d"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Notificación recibida:', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/assets/icon.png', // Si tienes ícono
    data: payload.data, // Aquí va la sala
    requireInteraction: true,
    actions: [
        {action: 'open', title: '📞 Contestar'}
    ]
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    // Al hacer clic, abre la app en receptor.html
    const urlToOpen = new URL('/receptor.html', self.location.origin).href;
    
    event.waitUntil(
        clients.matchAll({type: 'window', includeUncontrolled: true}).then(windowClients => {
            // Si ya está abierta, enfocarla
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            // Si no, abrir nueva
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
