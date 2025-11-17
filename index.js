require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Inicializar Firebase Admin
let serviceAccount;

// Para producción (Render), leer desde variable de entorno
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // Para desarrollo local, leer desde archivo
  serviceAccount = require('./firebaseConfig.json');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();

console.log('🚀 Firebase Admin inicializado correctamente');

// ============ LISTENER DE NOTIFICACIONES ============

/**
 * Escucha cambios en la colección de notificaciones
 */
function startNotificationListener() {
  console.log('👂 Escuchando nuevas notificaciones en Firestore...');
  
  db.collection('notifications')
    .where('pushSent', '==', false) // Solo notificaciones no enviadas
    .onSnapshot(async (snapshot) => {
      
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const notificationData = change.doc.data();
          const notificationId = change.doc.id;
          
          console.log(`📬 Nueva notificación detectada: ${notificationId}`);
          
          // Enviar push notification
          await sendPushNotification(notificationId, notificationData);
        }
      });
    }, (error) => {
      console.error('❌ Error en el listener:', error);
    });
}

/**
 * Envía una notificación push a un usuario específico
 */
async function sendPushNotification(notificationId, notificationData) {
  try {
    const { userId, title, message, type, relatedId } = notificationData;
    
    // 1. Obtener el FCM token del usuario
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.log(`⚠️  Usuario ${userId} no encontrado`);
      return;
    }
    
    const fcmToken = userDoc.data().fcmToken;
    
    if (!fcmToken) {
      console.log(`⚠️  Usuario ${userId} no tiene FCM token`);
      // Marcar como enviada de todas formas para no reintentar
      await markAsSent(notificationId);
      return;
    }
    
    // 2. Preparar el mensaje
    const pushMessage = {
      notification: {
        title: title || 'TicketTrack',
        body: message || 'Tienes una nueva notificación'
      },
      data: {
        notificationId: notificationId,
        type: type || 'GENERAL',
        relatedId: relatedId || '',
        click_action: 'FLUTTER_NOTIFICATION_CLICK'
      },
      token: fcmToken,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'ticket_track_notifications'
        }
      }
    };
    
    // 3. Enviar la notificación
    const response = await messaging.send(pushMessage);
    console.log(`✅ Notificación enviada exitosamente: ${response}`);
    
    // 4. Marcar como enviada en Firestore
    await markAsSent(notificationId);
    
  } catch (error) {
    console.error(`❌ Error al enviar notificación ${notificationId}:`, error);
    
    // Si el token es inválido, marcarlo de todas formas
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      console.log(`🗑️  Token inválido, marcando notificación como enviada`);
      await markAsSent(notificationId);
    }
  }
}

/**
 * Marca una notificación como enviada
 */
async function markAsSent(notificationId) {
  try {
    await db.collection('notifications').doc(notificationId).update({
      pushSent: true,
      pushSentAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ Notificación ${notificationId} marcada como enviada`);
  } catch (error) {
    console.error(`❌ Error al marcar notificación como enviada:`, error);
  }
}

// ============ ENDPOINTS DE SALUD ============

app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'TicketTrack Notification Service',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    firebase: 'connected',
    timestamp: new Date().toISOString()
  });
});

// ============ ENDPOINT MANUAL (OPCIONAL) ============

/**
 * Endpoint para enviar notificación manualmente (útil para testing)
 */
app.post('/send-notification', async (req, res) => {
  try {
    const { userId, title, message, type, relatedId } = req.body;
    
    if (!userId || !title || !message) {
      return res.status(400).json({
        error: 'userId, title y message son requeridos'
      });
    }
    
    // Crear notificación en Firestore
    const notificationRef = await db.collection('notifications').add({
      userId,
      title,
      message,
      type: type || 'GENERAL',
      relatedId: relatedId || '',
      isRead: false,
      pushSent: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      notificationId: notificationRef.id,
      message: 'Notificación creada, se enviará automáticamente'
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'Error al crear notificación',
      details: error.message
    });
  }
});

// ============ INICIAR SERVIDOR ============

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  
  // Iniciar el listener de notificaciones
  startNotificationListener();
});

// Manejo de errores no capturados
process.on('unhandledRejection', (error) => {
  console.error('❌ Error no manejado:', error);
});