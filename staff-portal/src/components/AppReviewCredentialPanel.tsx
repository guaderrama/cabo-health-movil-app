import { useEffect, useMemo, useState } from 'react';

import {
  createAppReviewCredentialModel,
  type AppReviewCredentialGateway,
  type AppReviewCredentialSnapshot,
} from '../domain/appReviewCredential.js';
import type { StaffLanguage, StaffMessageKey } from '../i18n/messages.js';
import { ConfirmDialog } from './ConfirmDialog.js';

interface AppReviewCredentialPanelProps {
  readonly gateway: AppReviewCredentialGateway;
  readonly language: StaffLanguage;
  readonly t: (key: StaffMessageKey) => string;
}

export function AppReviewCredentialPanel({
  gateway,
  language,
  t,
}: AppReviewCredentialPanelProps) {
  const model = useMemo(() => createAppReviewCredentialModel(gateway), [gateway]);
  const [snapshot, setSnapshot] = useState<AppReviewCredentialSnapshot>(model.getSnapshot());
  const [unavailable, setUnavailable] = useState(false);
  const [operationError, setOperationError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotateConfirmation, setRotateConfirmation] = useState(false);
  const [hideConfirmation, setHideConfirmation] = useState(false);

  const sync = () => setSnapshot(model.getSnapshot());
  const load = async () => {
    try {
      await model.load();
      sync();
      setUnavailable(false);
      setOperationError(false);
    } catch {
      setUnavailable(true);
    }
  };

  useEffect(() => { void load(); }, [model]);

  const rotate = async () => {
    setBusy(true);
    setOperationError(false);
    try {
      await model.rotate();
      sync();
      setRotateConfirmation(false);
    } catch {
      setOperationError(true);
      setRotateConfirmation(false);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (snapshot.oneTimeCredential === null) return;
    setOperationError(false);
    try {
      await navigator.clipboard.writeText(snapshot.oneTimeCredential);
      model.markCopied();
      sync();
    } catch {
      setOperationError(true);
    }
  };

  const hide = () => {
    try {
      model.acknowledgeHidden();
      sync();
      setHideConfirmation(false);
    } catch {
      setOperationError(true);
    }
  };

  const status = snapshot.status;
  return (
    <section aria-labelledby="review-title" className="workspace-panel">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">App Store review</p>
          <h2 id="review-title">{t('review.title')}</h2>
          <p>{t('review.subtitle')}</p>
        </div>
      </header>

      <div className="notice warning review-freeze" role="note">
        <strong>{t('review.freezeWarning')}</strong>
      </div>

      {unavailable ? (
        <div className="notice warning" role="status">
          <span>{t('review.unavailable')}</span>
          <button className="text-button" type="button" onClick={() => void load()}>{t('common.retry')}</button>
        </div>
      ) : null}
      {operationError ? (
        <div className="notice error" role="alert">
          <span>{t('review.failed')}</span>
          <button className="text-button" type="button" onClick={() => void load()}>{t('common.retry')}</button>
        </div>
      ) : null}

      {!unavailable && status !== null ? (
        <div className="review-status-card">
          <div>
            <p className="eyebrow">{t('review.status')}</p>
            <h3>{status.configured ? t('review.configured') : t('review.notConfigured')}</h3>
          </div>
          <dl className="review-facts">
            <div><dt>{t('review.generation')}</dt><dd>{status.generation ?? '—'}</dd></div>
            <div>
              <dt>{t('review.rotated')}</dt>
              <dd>{status.rotatedAtMs === null ? t('review.never') : new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(status.rotatedAtMs)}</dd>
            </div>
          </dl>
          <button
            className="button primary"
            disabled={busy || snapshot.oneTimeCredential !== null}
            type="button"
            onClick={() => setRotateConfirmation(true)}
          >
            {status.configured ? t('review.rotate') : t('review.generate')}
          </button>
        </div>
      ) : null}

      {snapshot.oneTimeCredential !== null ? (
        <section aria-live="assertive" className="one-time-code review-one-time">
          <div>
            <p className="eyebrow">{t('review.oneTimeTitle')}</p>
            <p>{t('review.oneTimeBody')}</p>
          </div>
          <output>{snapshot.oneTimeCredential}</output>
          <div className="inline-actions">
            <button className="button secondary" type="button" onClick={() => void copy()}>
              {snapshot.copied ? t('review.copied') : t('review.copy')}
            </button>
            <button
              className="button danger"
              disabled={!snapshot.copied || busy}
              type="button"
              onClick={() => setHideConfirmation(true)}
            >
              {t('review.hide')}
            </button>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={rotateConfirmation}
        title={t('review.confirmRotate')}
        confirmLabel={t('review.rotate')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        onCancel={() => setRotateConfirmation(false)}
        onConfirm={() => void rotate()}
      />
      <ConfirmDialog
        open={hideConfirmation}
        title={t('review.confirmHide')}
        confirmLabel={t('review.hide')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setHideConfirmation(false)}
        onConfirm={hide}
      />
    </section>
  );
}
