import { useEffect, useMemo, useState } from 'react';

import { createCodeAdminModel, type CodeAdminSnapshot } from '../domain/codeAdminModel.js';
import {
  REVIEWED_CLIENT_RESOURCE_IDS,
  type StaffGateway,
} from '../domain/staffGateway.js';
import type { StaffLanguage, StaffMessageKey } from '../i18n/messages.js';
import { ConfirmDialog } from './ConfirmDialog.js';

interface CodeAdminPanelProps {
  readonly gateway: StaffGateway;
  readonly language: StaffLanguage;
  readonly t: (key: StaffMessageKey) => string;
}

const EMPTY: CodeAdminSnapshot = Object.freeze({ codes: Object.freeze([]), oneTimeCode: null });

export function CodeAdminPanel({ gateway, language, t }: CodeAdminPanelProps) {
  const model = useMemo(() => createCodeAdminModel(gateway), [gateway]);
  const [snapshot, setSnapshot] = useState<CodeAdminSnapshot>(EMPTY);
  const [expiration, setExpiration] = useState(defaultExpirationDate);
  const [creating, setCreating] = useState(false);
  const [revokeCandidate, setRevokeCandidate] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  const refreshSnapshot = () => setSnapshot(model.getSnapshot());
  const load = async () => {
    setError(false);
    try {
      await model.load();
      refreshSnapshot();
    } catch {
      setError(true);
    }
  };

  useEffect(() => { void load(); }, [model]);

  const create = async () => {
    setCreating(true);
    setError(false);
    setCopied(false);
    try {
      await model.create({
        expiresAtMs: dateInputToUtcMs(expiration),
        resourceIds: REVIEWED_CLIENT_RESOURCE_IDS,
      });
      refreshSnapshot();
    } catch {
      setError(true);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!revokeCandidate) return;
    setError(false);
    try {
      await model.revoke(revokeCandidate);
      refreshSnapshot();
      setRevokeCandidate(null);
    } catch {
      setError(true);
    }
  };

  const copyCode = async () => {
    if (!snapshot.oneTimeCode) return;
    try {
      await navigator.clipboard.writeText(snapshot.oneTimeCode);
      setCopied(true);
    } catch {
      setCopied(false);
      setError(true);
    }
  };

  const acknowledge = () => {
    model.acknowledgeCodeCopied();
    setCopied(false);
    refreshSnapshot();
  };

  return (
    <section aria-labelledby="codes-title" className="workspace-panel">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">01</p>
          <h2 id="codes-title">{t('codes.title')}</h2>
          <p>{t('codes.subtitle')}</p>
        </div>
        <label className="compact-field">
          <span>{t('codes.expiration')}</span>
          <input type="date" value={expiration} min={todayDate()} onChange={(event) => setExpiration(event.target.value)} />
        </label>
        <button className="button primary" disabled={creating || !expiration || snapshot.oneTimeCode !== null} type="button" onClick={() => void create()}>
          {creating ? t('common.loading') : t('codes.create')}
        </button>
      </header>

      {error ? (
        <div className="notice error" role="alert">
          <span>{t('codes.unavailable')}</span>
          <button className="text-button" type="button" onClick={() => void load()}>{t('common.retry')}</button>
        </div>
      ) : null}

      <div className="code-access-grid">
        {snapshot.codes.length === 0 ? (
          <p className="notice">{t('codes.empty')}</p>
        ) : snapshot.codes.map((code, index) => (
          <article className="code-access active" key={code.codeId}>
            <div className="access-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
            <div className="access-copy">
              <p className="eyebrow">{t('codes.access')} {index + 1}</p>
              <h3>{t('codes.active')}</h3>
              <dl className="code-facts">
                <div><dt>{t('codes.suffix')}</dt><dd>•••• {code.displaySuffix}</dd></div>
                <div><dt>{t('codes.expires')}</dt><dd>{formatDate(code.expiresAtMs, language)}</dd></div>
              </dl>
            </div>
            <button className="text-button danger-text" type="button" onClick={() => setRevokeCandidate(code.codeId)}>
              {t('codes.revoke')}
            </button>
          </article>
        ))}
      </div>

      {snapshot.oneTimeCode ? (
        <aside aria-live="assertive" className="one-time-code">
          <div>
            <p className="eyebrow">{t('codes.oneTimeTitle')}</p>
            <p>{t('codes.oneTimeBody')}</p>
          </div>
          <output aria-label={t('codes.oneTimeTitle')}>{snapshot.oneTimeCode}</output>
          <div className="inline-actions">
            <button className="button secondary" type="button" onClick={() => void copyCode()}>
              {copied ? t('codes.copied') : t('codes.copy')}
            </button>
            <button className="button primary" disabled={!copied} type="button" onClick={acknowledge}>
              {t('codes.acknowledge')}
            </button>
          </div>
        </aside>
      ) : null}

      <ConfirmDialog
        open={revokeCandidate !== null}
        title={t('codes.confirmRevoke')}
        confirmLabel={t('codes.revoke')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setRevokeCandidate(null)}
        onConfirm={() => void revoke()}
      />
    </section>
  );
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultExpirationDate(): string {
  const nextMonth = new Date();
  nextMonth.setUTCDate(nextMonth.getUTCDate() + 30);
  return nextMonth.toISOString().slice(0, 10);
}

function dateInputToUtcMs(value: string): number {
  const result = Date.parse(`${value}T23:59:59.999Z`);
  if (!Number.isFinite(result) || result <= Date.now()) throw new Error('expiration_invalid');
  return result;
}

function formatDate(value: number, language: StaffLanguage): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(value);
}
