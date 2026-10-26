// firebase-config.js - OPTIONAL cloud sync. Leave `firebaseConfig = null` and Intake works fully offline on this device.
// To enable sync, paste your Firebase web-app config (Firebase console > Project settings > Your apps > Web app):
//
// export const firebaseConfig = {
//   apiKey: "AIza...",
//   authDomain: "your-project.firebaseapp.com",
//   projectId: "your-project",
//   storageBucket: "your-project.firebasestorage.app",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abcdef123456",
// };
//
// These values are not secrets; access is enforced by firestore.rules. See README.md.

export const firebaseConfig = null;
