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
import { WebApp, WebAppFirestore } from '../types';
import { config } from '../constants';

const COLLECTION_NAME = config.collections.webApps;

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
      const data = doc.data() as Omit<WebAppFirestore, 'id'>;
      apps.push({
        id: doc.id,
        name: data.name,
        description: data.description,
        url: data.url,
        icon: data.icon,
        color: data.color,
        category: data.category,
        order: data.order,
        isActive: Boolean(data.isActive),
        isNew: Boolean(data.isNew),
      });
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
          const data = doc.data() as Omit<WebAppFirestore, 'id'>;
          apps.push({
            id: doc.id,
            name: data.name,
            description: data.description,
            url: data.url,
            icon: data.icon,
            color: data.color,
            category: data.category,
            order: data.order,
            isActive: Boolean(data.isActive),
            isNew: Boolean(data.isNew),
          });
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
