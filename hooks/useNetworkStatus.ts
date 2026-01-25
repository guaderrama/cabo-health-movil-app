// hooks/useNetworkStatus.ts
// Hook para monitorear el estado de la conexión

import { useState, useEffect } from 'react';
import * as Network from 'expo-network';

interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: Network.NetworkStateType | null;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: null,
    type: null,
  });

  useEffect(() => {
    // Verificar estado inicial
    const checkInitialStatus = async () => {
      try {
        const networkState = await Network.getNetworkStateAsync();
        setStatus({
          isConnected: networkState.isConnected ?? false,
          isInternetReachable: networkState.isInternetReachable ?? null,
          type: networkState.type ?? null,
        });
      } catch (error) {
        console.error('Error checking network status:', error);
      }
    };

    checkInitialStatus();

    // Polling para verificar cambios (expo-network no tiene listener nativo)
    const interval = setInterval(async () => {
      try {
        const networkState = await Network.getNetworkStateAsync();
        setStatus((prev) => {
          const newStatus = {
            isConnected: networkState.isConnected ?? false,
            isInternetReachable: networkState.isInternetReachable ?? null,
            type: networkState.type ?? null,
          };

          // Solo actualizar si cambió
          if (
            prev.isConnected !== newStatus.isConnected ||
            prev.isInternetReachable !== newStatus.isInternetReachable
          ) {
            return newStatus;
          }
          return prev;
        });
      } catch (error) {
        console.error('Error polling network status:', error);
      }
    }, 5000); // Verificar cada 5 segundos

    return () => clearInterval(interval);
  }, []);

  return status;
}

export default useNetworkStatus;
