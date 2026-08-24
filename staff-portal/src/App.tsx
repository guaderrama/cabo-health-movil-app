import { useCallback, useEffect, useMemo, useState } from 'react';

import { AppReviewCredentialPanel } from './components/AppReviewCredentialPanel.js';
import { AuditPanel } from './components/AuditPanel.js';
import { CatalogDraftPanel } from './components/CatalogDraftPanel.js';
import { CodeAdminPanel } from './components/CodeAdminPanel.js';
import { isStaffAuthorizationBoundaryError } from './domain/authBoundary.js';
import type {
  FirebaseStaffServices,
  StaffSignInResult,
} from './firebase/firebaseStaffServices.js';
import {
  STAFF_MESSAGES,
  type StaffLanguage,
  type StaffMessageKey,
} from './i18n/messages.js';

interface AppProps {
  readonly services: FirebaseStaffServices;
}

type PortalTab = 'codes' | 'drafts' | 'audit' | 'app-review';
type Authenticated = Extract<StaffSignInResult, { kind: 'authenticated' }>;
type AuthStage = 'restoring' | 'sign-in' | 'authenticated';
type AuthNotice = 'verification-sent' | 'password-reset-sent' | null;
type AuthError = 'auth.denied' | 'auth.failed' | null;

export function App({ services }: AppProps) {
  const [language, setLanguage] = useState<StaffLanguage>('en');
  const [stage, setStage] = useState<AuthStage>('restoring');
  const [authenticated, setAuthenticated] = useState<Authenticated | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<AuthError>(null);
  const [authNotice, setAuthNotice] = useState<AuthNotice>(null);
  const [tab, setTab] = useState<PortalTab>('codes');
  const t = useMemo(() => (
    (key: StaffMessageKey): string => STAFF_MESSAGES[language][key]
  ), [language]);

  const resetAuthorization = useCallback(() => {
    setAuthenticated(null);
    setEmail('');
    setPassword('');
    setBusy(false);
    setAuthError('auth.denied');
    setAuthNotice(null);
    setTab('codes');
    setStage('sign-in');
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => services.onAuthorizationLost(resetAuthorization), [resetAuthorization, services]);

  useEffect(() => {
    let active = true;
    void services.restore().then((restored) => {
      if (!active) return;
      if (restored) {
        setAuthenticated(restored);
        setTab(firstPortalTab(restored));
        setStage('authenticated');
      } else {
        setStage('sign-in');
      }
    });
    return () => { active = false; };
  }, [services]);

  const submitCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setAuthError(null);
    setAuthNotice(null);
    const submittedPassword = password;
    setPassword('');
    try {
      const result = await services.signIn(email, submittedPassword);
      if (result.kind === 'email-verification-required') {
        setAuthNotice('verification-sent');
        setStage('sign-in');
      } else {
        setAuthenticated(result);
        setTab(firstPortalTab(result));
        setStage('authenticated');
      }
    } catch (error) {
      setAuthError(isStaffAuthorizationBoundaryError(error) ? 'auth.denied' : 'auth.failed');
      setStage('sign-in');
    } finally {
      setBusy(false);
    }
  };

  const requestPasswordReset = async () => {
    setBusy(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      await services.requestPasswordReset(email);
      setAuthNotice('password-reset-sent');
    } catch {
      setAuthError('auth.failed');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    await services.signOut();
    setAuthenticated(null);
    setEmail('');
    setPassword('');
    setAuthError(null);
    setAuthNotice(null);
    setTab('codes');
    setStage('sign-in');
  };

  if (stage === 'restoring') {
    return <main className="auth-layout"><Brand /><p aria-live="polite">{t('common.loading')}</p></main>;
  }

  if (stage === 'sign-in') {
    return (
      <main className="auth-layout">
        <div className="language-control">
          <button aria-label="Portal language" className="text-button" type="button" onClick={() => setLanguage(language === 'en' ? 'es-MX' : 'en')}>
            {t('common.language')}
          </button>
        </div>
        <section className="auth-card" aria-labelledby="auth-title">
          <Brand />
          <p className="eyebrow">{t('portal.eyebrow')}</p>
          <h1 id="auth-title">{t('auth.title')}</h1>
          <p>{t('auth.subtitle')}</p>
          {authError ? <div className="notice error" role="alert">{t(authError)}</div> : null}
          {authNotice === 'verification-sent' ? <div className="notice" role="status">{t('auth.verificationSent')}</div> : null}
          {authNotice === 'password-reset-sent' ? <div className="notice" role="status">{t('auth.passwordResetSent')}</div> : null}
          <form className="auth-form" onSubmit={(event) => void submitCredentials(event)}>
            <label className="field"><span>{t('auth.email')}</span><input autoComplete="username" inputMode="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label className="field"><span>{t('auth.password')}</span><input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <p className="password-policy">{t('auth.passwordPolicy')}</p>
            <button className="button primary full" disabled={busy} type="submit">{busy ? t('common.loading') : t('auth.signIn')}</button>
            <button className="text-button" disabled={busy || email.trim() === ''} type="button" onClick={() => void requestPasswordReset()}>{t('auth.resetPassword')}</button>
          </form>
        </section>
      </main>
    );
  }

  if (!authenticated) return null;

  const canManageCodes = authenticated.session.permissions.includes('client_codes');
  const canManageDrafts = authenticated.session.scope === 'production'
    && authenticated.session.permissions.includes('client_resource_drafts');
  const canManageAppReview = authenticated.session.scope === 'production'
    && authenticated.session.permissions.includes('app_review_credential');

  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <Brand />
        <div className="sidebar-intro">
          <p className="eyebrow">{t('portal.eyebrow')}</p>
          <h1>{t('portal.title')}</h1>
          <p>{t('portal.subtitle')}</p>
        </div>
        <nav aria-label="Staff workspace" className="portal-nav">
          {canManageCodes ? <NavButton active={tab === 'codes'} number="01" label={t('nav.codes')} onClick={() => setTab('codes')} /> : null}
          {canManageDrafts ? <NavButton active={tab === 'drafts'} number="02" label={t('nav.drafts')} onClick={() => setTab('drafts')} /> : null}
          {canManageDrafts ? <NavButton active={tab === 'audit'} number="03" label={t('nav.audit')} onClick={() => setTab('audit')} /> : null}
          {canManageAppReview ? <NavButton active={tab === 'app-review'} number="04" label={t('nav.review')} onClick={() => setTab('app-review')} /> : null}
        </nav>
        <div className="sidebar-footer">
          <div className="scope-block">
            <span className={`scope-dot ${authenticated.session.scope}`} aria-hidden="true" />
            <div>
              <strong>{authenticated.session.scope === 'production' ? t('portal.production') : t('portal.reviewSandbox')}</strong>
              <small>{t('portal.scopeHelp')}</small>
            </div>
          </div>
          <div className="sidebar-actions">
            <button aria-label="Portal language" className="text-button" type="button" onClick={() => setLanguage(language === 'en' ? 'es-MX' : 'en')}>{t('common.language')}</button>
            <button className="text-button" type="button" onClick={() => void leave()}>{t('common.signOut')}</button>
          </div>
        </div>
      </aside>
      <main className="portal-main">
        {tab === 'codes' && canManageCodes ? <CodeAdminPanel gateway={authenticated.gateway} language={language} t={t} /> : null}
        {tab === 'drafts' && canManageDrafts ? <CatalogDraftPanel gateway={authenticated.draftGateway} language={language} t={t} /> : null}
        {tab === 'audit' && canManageDrafts ? <AuditPanel gateway={authenticated.auditGateway} language={language} t={t} /> : null}
        {tab === 'app-review' && canManageAppReview ? <AppReviewCredentialPanel gateway={authenticated.appReviewGateway} language={language} t={t} /> : null}
      </main>
    </div>
  );
}

function firstPortalTab(authenticated: Authenticated): PortalTab {
  if (authenticated.session.permissions.includes('client_codes')) return 'codes';
  if (authenticated.session.scope === 'production'
    && authenticated.session.permissions.includes('client_resource_drafts')) return 'drafts';
  if (authenticated.session.scope === 'production'
    && authenticated.session.permissions.includes('app_review_credential')) return 'app-review';
  return 'codes';
}

function Brand() {
  return <div aria-label="CaboHealth" className="brand-mark"><span>CABO</span><span>HEALTH</span></div>;
}

function NavButton(props: { active: boolean; number: string; label: string; onClick: () => void }) {
  return (
    <button aria-current={props.active ? 'page' : undefined} className={props.active ? 'nav-button active' : 'nav-button'} type="button" onClick={props.onClick}>
      <span>{props.number}</span>{props.label}
    </button>
  );
}
