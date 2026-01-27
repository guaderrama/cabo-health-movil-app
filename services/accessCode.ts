// services/accessCode.ts
// Service for validating access codes against Firebase

import { collection, query, where, getDocs, updateDoc, doc, Timestamp } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from './firebase';
import { config } from '../constants';
import { AccessCode, AccessCodeResult } from '../types';

const COLLECTION = config.collections.accessCodes;
const STORAGE_KEY = config.storageKeys.accessCode;
const CLIENT_NAME_KEY = config.storageKeys.clientName;

// Master admin code - bypasses Firebase validation
const ADMIN_CODE = 'CABO-ADMIN2024';

/**
 * Check if code is the admin master code
 */
export function isAdminCode(code: string): boolean {
  return code.toUpperCase().replace(/-/g, '') === ADMIN_CODE.replace(/-/g, '');
}

/**
 * Validate an access code against Firebase
 */
export async function validateAccessCode(code: string): Promise<AccessCodeResult> {
  try {
    const normalizedCode = code.toUpperCase().trim();

    // Check for admin code first
    if (isAdminCode(normalizedCode)) {
      // Store admin code locally
      await AsyncStorage.setItem(STORAGE_KEY, ADMIN_CODE);
      await AsyncStorage.setItem(CLIENT_NAME_KEY, 'Administrator');
      return {
        isValid: true,
        clientName: 'Administrator',
      };
    }

    const q = query(
      collection(db, COLLECTION),
      where('code', '==', normalizedCode)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return { isValid: false, error: 'invalid' };
    }

    const docData = snapshot.docs[0].data() as AccessCode;
    const docId = snapshot.docs[0].id;

    // Check if code is active
    if (!docData.isActive) {
      return { isValid: false, error: 'revoked' };
    }

    // Check if code has expired
    if (docData.expiresAt) {
      const expiresAt = docData.expiresAt instanceof Timestamp
        ? docData.expiresAt.toDate()
        : new Date(docData.expiresAt);

      if (expiresAt < new Date()) {
        return { isValid: false, error: 'expired', expiresAt };
      }
    }

    // Update last used timestamp
    try {
      await updateDoc(doc(db, COLLECTION, docId), {
        lastUsedAt: Timestamp.now()
      });
    } catch (updateError) {
      // Non-critical, continue even if update fails
      console.warn('Failed to update lastUsedAt:', updateError);
    }

    // Store code and client name locally
    await AsyncStorage.setItem(STORAGE_KEY, normalizedCode);
    await AsyncStorage.setItem(CLIENT_NAME_KEY, docData.clientName);

    return {
      isValid: true,
      clientName: docData.clientName,
      expiresAt: docData.expiresAt instanceof Timestamp
        ? docData.expiresAt.toDate()
        : docData.expiresAt
    };
  } catch (error) {
    console.error('Error validating access code:', error);
    return { isValid: false, error: 'network_error' };
  }
}

/**
 * Check if there's a stored code and if it's still valid
 */
export async function checkStoredCode(): Promise<AccessCodeResult> {
  try {
    const storedCode = await AsyncStorage.getItem(STORAGE_KEY);

    if (!storedCode) {
      return { isValid: false, error: 'invalid' };
    }

    // Validate stored code against Firebase
    return await validateAccessCode(storedCode);
  } catch (error) {
    console.error('Error checking stored code:', error);
    return { isValid: false, error: 'network_error' };
  }
}

/**
 * Get stored code without validating (for quick checks)
 */
export async function getStoredCode(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Get stored client name
 */
export async function getStoredClientName(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CLIENT_NAME_KEY);
  } catch {
    return null;
  }
}

/**
 * Clear stored code (logout)
 */
export async function clearStoredCode(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([STORAGE_KEY, CLIENT_NAME_KEY]);
  } catch (error) {
    console.error('Error clearing stored code:', error);
  }
}

/**
 * Format access code for display (CABO-XXXXXXXX)
 */
export function formatAccessCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length <= 4) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

/**
 * Parse input and remove formatting
 */
export function parseAccessCodeInput(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9-]/g, '');
}
