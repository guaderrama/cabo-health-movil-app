import { type ReactNode, useEffect, useState } from 'react';
import { loadClientAccessRuntime } from '../features/clientAccess/clientAccessRuntime';
import { ClientAccessProvider } from './ClientAccessContext';

type ClientAccessRuntime = Awaited<ReturnType<typeof loadClientAccessRuntime>>;

export function ClientAccessBootstrap({ children }: { readonly children: ReactNode }) {
  const [runtime, setRuntime] = useState<ClientAccessRuntime>(null);

  useEffect(() => {
    let active = true;
    loadClientAccessRuntime()
      .then((loaded) => {
        if (active && loaded !== null) setRuntime(loaded);
      })
      .catch(() => {
        if (active) setRuntime(null);
      });
    return () => { active = false; };
  }, []);

  return (
    <ClientAccessProvider
      key={runtime === null ? 'locked' : 'native'}
      deletionTracker={runtime?.deletionTracker}
      gateway={runtime?.gateway}
      sessionStore={runtime?.sessionStore}
    >
      {children}
    </ClientAccessProvider>
  );
}
