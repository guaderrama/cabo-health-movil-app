import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import {
  createUnavailableAuditGateway,
  createUnavailableCatalogDraftGateway,
} from './domain/unavailableGateways.js';
import {
  createFirebaseStaffServices,
} from './firebase/firebaseStaffServices.js';
import {
  STAFF_FUNCTIONS_REGION,
  validateStaffFirebaseConfig,
} from './firebase/staffFirebaseConfig.js';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('staff_root_missing');

const root = createRoot(rootElement);

try {
  const config = validateStaffFirebaseConfig({
    firebase: {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    },
    appCheckSiteKey: import.meta.env.VITE_FIREBASE_APPCHECK_ENTERPRISE_SITE_KEY,
    functionsRegion: import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || STAFF_FUNCTIONS_REGION,
    deployment: __STAFF_DEPLOYMENT_IDENTITY__,
  });
  const services = createFirebaseStaffServices(config);
  root.render(
    <StrictMode>
      <App
        services={services}
        draftGateway={createUnavailableCatalogDraftGateway()}
        auditGateway={createUnavailableAuditGateway()}
      />
    </StrictMode>,
  );
} catch {
  root.render(
    <main className="auth-layout">
      <section className="auth-card" role="alert">
        <div aria-label="CaboHealth" className="brand-mark"><span>CABO</span><span>HEALTH</span></div>
        <p className="eyebrow">Staff portal · Portal del personal</p>
        <h1>Secure setup required</h1>
        <p>The portal is closed until its verified production configuration is installed.</p>
        <p>El portal permanece cerrado hasta instalar su configuración verificada de producción.</p>
      </section>
    </main>,
  );
}
