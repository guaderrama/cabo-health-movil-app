// hooks/useAccessCode.ts
// Hook for managing access code state

import { useState, useEffect, useCallback } from 'react';
import {
  validateAccessCode,
  checkStoredCode,
  getStoredCode,
  getStoredClientName,
  clearStoredCode,
} from '../services/accessCode';
import { AccessCodeState, AccessCodeResult } from '../types';

interface UseAccessCodeReturn extends AccessCodeState {
  validateCode: (code: string) => Promise<AccessCodeResult>;
  checkCode: () => Promise<AccessCodeResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAccessCode(): UseAccessCodeReturn {
  const [state, setState] = useState<AccessCodeState>({
    hasValidCode: false,
    isLoading: true,
    clientName: null,
    code: null,
    error: null,
  });

  // Initial check on mount
  useEffect(() => {
    checkCode();
  }, []);

  /**
   * Check stored code and validate it
   */
  const checkCode = useCallback(async (): Promise<AccessCodeResult> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const storedCode = await getStoredCode();

      if (!storedCode) {
        setState(prev => ({
          ...prev,
          hasValidCode: false,
          isLoading: false,
          clientName: null,
          code: null,
          error: null,
        }));
        return { isValid: false, error: 'invalid' };
      }

      const result = await checkStoredCode();

      if (result.isValid) {
        const clientName = await getStoredClientName();
        setState(prev => ({
          ...prev,
          hasValidCode: true,
          isLoading: false,
          clientName: clientName || result.clientName || null,
          code: storedCode,
          error: null,
        }));
      } else {
        // Code is no longer valid - could be revoked or expired
        setState(prev => ({
          ...prev,
          hasValidCode: false,
          isLoading: false,
          clientName: null,
          code: storedCode, // Keep code for display purposes
          error: result.error || 'invalid',
        }));
      }

      return result;
    } catch (error) {
      console.error('Error checking code:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'network_error',
      }));
      return { isValid: false, error: 'network_error' };
    }
  }, []);

  /**
   * Validate a new code
   */
  const validateCode = useCallback(async (code: string): Promise<AccessCodeResult> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await validateAccessCode(code);

      if (result.isValid) {
        setState(prev => ({
          ...prev,
          hasValidCode: true,
          isLoading: false,
          clientName: result.clientName || null,
          code: code,
          error: null,
        }));
      } else {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: result.error || 'invalid',
        }));
      }

      return result;
    } catch (error) {
      console.error('Error validating code:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'network_error',
      }));
      return { isValid: false, error: 'network_error' };
    }
  }, []);

  /**
   * Logout - clear stored code
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      await clearStoredCode();
      setState(prev => ({
        ...prev,
        hasValidCode: false,
        isLoading: false,
        clientName: null,
        code: null,
        error: null,
      }));
    } catch (error) {
      console.error('Error during logout:', error);
      // Still reset state even if storage clear fails
      setState(prev => ({
        ...prev,
        hasValidCode: false,
        isLoading: false,
        clientName: null,
        code: null,
        error: null,
      }));
    }
  }, []);

  /**
   * Refresh - re-check the stored code
   */
  const refresh = useCallback(async (): Promise<void> => {
    await checkCode();
  }, [checkCode]);

  return {
    ...state,
    validateCode,
    checkCode,
    logout,
    refresh,
  };
}

export default useAccessCode;
