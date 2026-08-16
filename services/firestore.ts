// services/firestore.ts
// Operaciones de Firestore para WebApp Launcher

import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { getFirestoreDB } from './firebase';
import { WebApp } from '../types';

interface WebAppFirestore extends WebApp {
  createdAt: Date;
  updatedAt: Date;
}

const COLLECTION_NAME = 'cabohealth_apps';

/**
 * Validate that Firestore data has required fields
 */
function isValidWebAppData(data: unknown): data is Omit<WebAppFirestore, 'id'> {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.name === 'string' &&
    typeof d.url === 'string' &&
    typeof d.order === 'number'
  );
}

/**
 * Safely convert Firestore document to WebApp
 */
function toWebApp(docId: string, data: unknown): WebApp | null {
  if (!isValidWebAppData(data)) {
    console.warn(`Invalid WebApp data for document ${docId}:`, data);
    return null;
  }
  return {
    id: docId,
    name: data.name || 'Untitled',
    description: data.description || '',
    url: data.url,
    icon: data.icon,
    color: data.color,
    category: data.category,
    order: data.order ?? 999,
    isActive: Boolean(data.isActive),
    isNew: Boolean(data.isNew),
  };
}

/**
 * Obtiene todas las web apps activas de Firestore
 */
export async function fetchWebApps(): Promise<WebApp[]> {
  try {
    const db = getFirestoreDB();
    const webAppsRef = collection(db, COLLECTION_NAME);
    const q = query(
      webAppsRef,
      where('isActive', '==', true),
      orderBy('order', 'asc')
    );

    const snapshot = await getDocs(q);
    const apps: WebApp[] = [];

    snapshot.forEach((doc) => {
      const app = toWebApp(doc.id, doc.data());
      if (app) {
        apps.push(app);
      }
    });

    return apps;
  } catch (error) {
    console.error('Error fetching web apps:', error);
    throw error;
  }
}

/**
 * Suscribe a cambios en tiempo real de las web apps
 */
export function subscribeToWebApps(
  onUpdate: (apps: WebApp[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  try {
    const db = getFirestoreDB();
    const webAppsRef = collection(db, COLLECTION_NAME);
    const q = query(
      webAppsRef,
      where('isActive', '==', true),
      orderBy('order', 'asc')
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const apps: WebApp[] = [];
        snapshot.forEach((doc) => {
          const app = toWebApp(doc.id, doc.data());
          if (app) {
            apps.push(app);
          }
        });
        onUpdate(apps);
      },
      (error) => {
        console.error('Error in web apps subscription:', error);
        onError(error);
      }
    );
  } catch (error) {
    console.error('Error setting up web apps subscription:', error);
    throw error;
  }
}

/**
 * Obtiene una web app por su ID
 */
export async function fetchWebAppById(id: string): Promise<WebApp | null> {
  try {
    const apps = await fetchWebApps();
    return apps.find((app) => app.id === id) || null;
  } catch (error) {
    console.error('Error fetching web app by id:', error);
    throw error;
  }
}
