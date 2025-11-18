const admin = require('firebase-admin');

// Inicializar Firebase Admin (solo una vez)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT || '{}'
  );
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const messaging = admin.messaging();

/**
 * Endpoint serverless para enviar notificación push
 */
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, title, message, type, relatedId } = req.body;

    if (!userId || !title || !message) {
      return res.status(400).json({
        error: 'userId, title y message son requeridos'
      });
    }

    // 1. Obtener FCM token del usuario
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    const fcmToken = userDoc.data().fcmToken;

    if (!fcmToken) {
      return res.status(400).json({
        error: 'Usuario sin FCM token registrado'
      });
    }

    // 2. Preparar mensaje push
    const pushMessage = {
      notification: {
        title: title,
        body: message
      },
      data: {
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

    // 3. Enviar push notification
    const response = await messaging.send(pushMessage);

    return res.status(200).json({
      success: true,
      messageId: response,
      message: 'Notificación enviada correctamente'
    });

  } catch (error) {
    console.error('Error:', error);
    
    // Manejar tokens inválidos
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      return res.status(400).json({
        error: 'Token FCM inválido o expirado'
      });
    }

    return res.status(500).json({
      error: 'Error al enviar notificación',
      details: error.message
    });
  }
};