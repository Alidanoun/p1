const firebaseService = require('../src/services/firebaseService');

async function testDirectPush() {
  const token = 'cuXAGv7yQOO8W6qfvHeB-2:APA91bFXqB3DPemOwHwZlKu3xgs9fDi4ctt7aoq7Qyk-zo_BRpbOFq5R33qD08DSCInLPkJLsJAUuHEhQLBYNwZyVGUkHBb4qycOD7EBZZ0tE6DEJDTl4Ts';
  
  console.log('🚀 Sending direct FCM test...');
  const success = await firebaseService.sendToToken(
    token, 
    'إختبار مباشر 🧪', 
    'هذا الإشعار مرسل مباشرة من السيرفر لاختبار Firebase',
    { testId: 'direct_fcm_test', timestamp: String(Date.now()) }
  );

  if (success) {
    console.log('✅ FCM request accepted by Google. Check your phone!');
  } else {
    console.log('❌ FCM request failed. Check server logs.');
  }
  process.exit(0);
}

testDirectPush();
