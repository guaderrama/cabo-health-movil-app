/// <reference types="vite/client" />

declare const __STAFF_DEPLOYMENT_IDENTITY__: Readonly<{
  appEnv: 'staging' | 'production';
  expectedProjectId: string;
  expectedWebAppId: string;
  backendStaffWebAppId: string;
}> | null;
