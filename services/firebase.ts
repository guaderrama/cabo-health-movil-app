// services/firebase.ts
// Configuración de Firebase para CaboHealth

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

// Configuración de Firebase - Proyecto InstalacionMariposas
const firebaseConfig = {
  apiKey: "AIzaSyCz_du9pqA8Uye_Sgm4baekxg7ldqGRGko",
  authDomain: "instalacionmariposas.firebaseapp.com",
  projectId: "instalacionmariposas",
  storageBucket: "instalacionmariposas.firebasestorage.app",
  messagingSenderId: "79329581996",
  appId: "1:79329581996:web:15981c2e0d506cca5d3809",
  measurementId: "G-M071Z3W15Y"
};

// Inicializar Firebase solo si no está inicializado
let app: FirebaseApp;
let firestoreDb: Firestore;

function initializeFirebase(): FirebaseApp {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  return app;
}

function getFirestoreDB(): Firestore {
  if (!firestoreDb) {
    const firebaseApp = initializeFirebase();
    firestoreDb = getFirestore(firebaseApp);
  }
  return firestoreDb;
}

// Inicializar y exportar db directamente para uso fácil
const firebaseApp = initializeFirebase();
const db = getFirestore(firebaseApp);

export { initializeFirebase, getFirestoreDB, db };
export default initializeFirebase;
