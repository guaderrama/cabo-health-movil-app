// scripts/seed-firestore.ts
// Script para cargar datos iniciales en Firestore
//
// USO:
// 1. Primero configura las credenciales en services/firebase.ts
// 2. Ejecuta: npx ts-node scripts/seed-firestore.ts
//
// O copia los datos manualmente en Firebase Console → Firestore

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';

// ⚠️ IMPORTANTE: Usa las mismas credenciales de services/firebase.ts
const firebaseConfig = {
  apiKey: "AIzaSyCz_du9pqA8Uye_Sgm4baekxg7ldqGRGko",
  authDomain: "instalacionmariposas.firebaseapp.com",
  projectId: "instalacionmariposas",
  storageBucket: "instalacionmariposas.firebasestorage.app",
  messagingSenderId: "79329581996",
  appId: "1:79329581996:web:15981c2e0d506cca5d3809"
};

// Datos iniciales de web apps
const initialWebApps = [
  {
    name: 'Analizador de Cosméticos',
    description: 'Analiza ingredientes de productos',
    url: 'https://incidecoder.com',
    icon: '💄',
    color: '#FFE4E1',
    order: 1,
    isActive: true,
    isNew: false,
  },
  {
    name: 'Calculadora Nutricional',
    description: 'Calcula macros y calorías',
    url: 'https://www.fatsecret.com',
    icon: '🥗',
    color: '#E8F5E9',
    order: 2,
    isActive: true,
    isNew: false,
  },
  {
    name: 'Generador de Paletas',
    description: 'Crea combinaciones de colores',
    url: 'https://coolors.co',
    icon: '🎨',
    color: '#E3F2FD',
    order: 3,
    isActive: true,
    isNew: true,
  },
  {
    name: 'Conversor de Unidades',
    description: 'Convierte medidas fácilmente',
    url: 'https://www.unitconverters.net',
    icon: '📐',
    color: '#FFF3E0',
    order: 4,
    isActive: true,
    isNew: false,
  },
  {
    name: 'Notas Rápidas',
    description: 'Toma notas al instante',
    url: 'https://privnote.com',
    icon: '📝',
    color: '#F3E5F5',
    order: 5,
    isActive: true,
    isNew: false,
  },
  {
    name: 'Clima',
    description: 'Pronóstico del tiempo',
    url: 'https://weather.com',
    icon: '🌤️',
    color: '#E0F7FA',
    order: 6,
    isActive: true,
    isNew: false,
  },
];

async function seedFirestore() {
  console.log('🚀 Iniciando seed de Firestore...\n');

  try {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const webAppsRef = collection(db, 'cabohealth_apps');

    for (const webApp of initialWebApps) {
      const docRef = await addDoc(webAppsRef, {
        ...webApp,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      console.log(`✅ Creada: ${webApp.name} (ID: ${docRef.id})`);
    }

    console.log('\n🎉 Seed completado! Se crearon', initialWebApps.length, 'web apps.');
  } catch (error) {
    console.error('❌ Error durante el seed:', error);
    process.exit(1);
  }
}

// Ejecutar si es el archivo principal
seedFirestore();
