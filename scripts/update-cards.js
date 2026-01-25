// scripts/update-cards.js
// Script para actualizar las cards en Firebase
// Ejecutar con: node scripts/update-cards.js

const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  collection,
  getDocs,
  deleteDoc,
  doc,
  addDoc,
  serverTimestamp
} = require('firebase/firestore');

// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCz_du9pqA8Uye_Sgm4baekxg7ldqGRGko",
  authDomain: "instalacionmariposas.firebaseapp.com",
  projectId: "instalacionmariposas",
  storageBucket: "instalacionmariposas.firebasestorage.app",
  messagingSenderId: "79329581996",
  appId: "1:79329581996:web:15981c2e0d506cca5d3809",
};

// Nuevas cards de CaboHealth
const newCards = [
  {
    name: 'Sleep Lab',
    description: 'Optimize sleep quality through evidence-based protocols and personalized AI tools.',
    url: 'https://sleep-lab-by-cabo-health.vercel.app/',
    category: 'bienestar',
    order: 1,
    isActive: true,
    isNew: true,
  },
  {
    name: 'Gut Health',
    description: 'Clinical AI assistant to restore gut health through regenerative protocols.',
    url: 'https://guthealth-gu-a-de-medicina-regenerativa-153469590966.us-west1.run.app/',
    category: 'salud',
    order: 2,
    isActive: true,
    isNew: true,
  },
  {
    name: 'AI Cosmetic Scan',
    description: 'AI-powered cosmetic ingredient analysis for healthier beauty choices.',
    url: 'https://cosmetiscan-ai-by-cabo-health-153469590966.us-west1.run.app/',
    category: 'belleza',
    order: 3,
    isActive: true,
    isNew: true,
  },
  {
    name: 'Health Advisor',
    description: 'Discover services in your 6-month Advisor program with personalized follow-up.',
    url: 'https://replit.com/@jonathangs279/Cabo-Health-Advisor',
    category: 'salud',
    order: 4,
    isActive: true,
    isNew: false,
  },
  {
    name: 'Service Hub Portal',
    description: 'Access your protocol details, clinical docs, and specialized AI tools.',
    url: 'https://cabohealthsupport.replit.app/login',
    category: 'tecnologia',
    order: 5,
    isActive: true,
    isNew: false,
  },
];

async function updateCards() {
  console.log('🚀 Iniciando actualización de cards...\n');

  // Inicializar Firebase
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const collectionRef = collection(db, 'cabohealth_apps');

  try {
    // 1. Obtener y borrar cards existentes
    console.log('🗑️  Borrando cards existentes...');
    const snapshot = await getDocs(collectionRef);

    let deleteCount = 0;
    for (const docSnapshot of snapshot.docs) {
      await deleteDoc(doc(db, 'cabohealth_apps', docSnapshot.id));
      console.log(`   ❌ Borrado: ${docSnapshot.data().name}`);
      deleteCount++;
    }
    console.log(`   ✅ ${deleteCount} cards borradas\n`);

    // 2. Agregar nuevas cards
    console.log('➕ Agregando nuevas cards...');
    for (const card of newCards) {
      const docRef = await addDoc(collectionRef, {
        ...card,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      console.log(`   ✅ Agregado: ${card.name} (${card.category})`);
    }
    console.log(`\n🎉 ${newCards.length} cards agregadas exitosamente!`);

    console.log('\n📱 Recarga la app para ver los cambios.');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  process.exit(0);
}

updateCards();
