import { useEffect, useMemo, useState } from 'react';

import {
  STAFF_DRAFT_ICONS,
  createCatalogDraftModel,
  validateDraftInput,
  type CatalogDraft,
  type CatalogDraftGateway,
  type CatalogDraftInput,
  type StaffDraftAccess,
  type StaffDraftIcon,
} from '../domain/catalogDrafts.js';
import type { StaffLanguage, StaffMessageKey } from '../i18n/messages.js';
import { ConfirmDialog } from './ConfirmDialog.js';

interface CatalogDraftPanelProps {
  readonly gateway: CatalogDraftGateway;
  readonly language: StaffLanguage;
  readonly t: (key: StaffMessageKey) => string;
}

interface DraftForm {
  readonly url: string;
  readonly titleEn: string;
  readonly titleEs: string;
  readonly summaryEn: string;
  readonly summaryEs: string;
  readonly icon: StaffDraftIcon;
  readonly access: StaffDraftAccess;
}

const EMPTY_FORM: DraftForm = Object.freeze({
  url: '',
  titleEn: '',
  titleEs: '',
  summaryEn: '',
  summaryEs: '',
  icon: 'guide' as StaffDraftIcon,
  access: 'public' as StaffDraftAccess,
});

export function CatalogDraftPanel({ gateway, language, t }: CatalogDraftPanelProps) {
  const model = useMemo(() => createCatalogDraftModel(gateway), [gateway]);
  const [drafts, setDrafts] = useState<readonly CatalogDraft[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [editing, setEditing] = useState<CatalogDraft | null>(null);
  const [archiveCandidate, setArchiveCandidate] = useState<CatalogDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(false);

  const sync = () => setDrafts(model.getSnapshot().drafts);
  const load = async () => {
    try {
      await model.load();
      sync();
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  };

  useEffect(() => { void load(); }, [model]);

  const startNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(false);
    setFormOpen(true);
  };

  const startEdit = (draft: CatalogDraft) => {
    setEditing(draft);
    setForm({
      url: draft.url,
      titleEn: draft.title.en,
      titleEs: draft.title['es-MX'],
      summaryEn: draft.summary.en,
      summaryEs: draft.summary['es-MX'],
      icon: draft.icon,
      access: draft.access,
    });
    setFormError(false);
    setFormOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setFormError(false);
    try {
      const input = toDraftInput(form);
      if (editing) await model.update(editing.draftId, editing.revision, input);
      else await model.create(input);
      sync();
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch {
      setFormError(true);
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!archiveCandidate) return;
    setBusy(true);
    try {
      await model.archive(archiveCandidate.draftId, archiveCandidate.revision);
      sync();
      setArchiveCandidate(null);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="drafts-title" className="workspace-panel">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">Editorial queue</p>
          <h2 id="drafts-title">{t('drafts.title')}</h2>
          <p>{t('drafts.subtitle')}</p>
        </div>
        {!unavailable ? <button className="button primary" type="button" onClick={startNew}>{t('drafts.add')}</button> : null}
      </header>

      <div className="notice review-gate" role="note">{t('drafts.reviewGate')}</div>

      {unavailable ? (
        <div className="notice warning" role="status">
          <span>{t('drafts.unavailable')}</span>
          <button className="text-button" type="button" onClick={() => void load()}>{t('common.retry')}</button>
        </div>
      ) : null}

      {!unavailable && drafts.length === 0 ? <p className="empty-state">{t('drafts.empty')}</p> : null}
      {!unavailable && drafts.length > 0 ? (
        <div className="draft-list">
          {drafts.map((draft) => (
            <article className="draft-row" key={draft.draftId}>
              <span className="draft-icon" aria-hidden="true">{iconSymbol(draft.icon)}</span>
              <div>
                <p className="eyebrow">{draft.access === 'clients' ? t('drafts.clients') : t('drafts.public')}</p>
                <h3>{draft.title[language]}</h3>
                <p>{draft.summary[language]}</p>
                <a href={draft.url} target="_blank" rel="noopener noreferrer">{draft.url}</a>
              </div>
              <div className="row-actions">
                {draft.status === 'draft' ? (
                  <>
                    <button className="text-button" type="button" onClick={() => startEdit(draft)}>{t('drafts.edit')}</button>
                    <button className="text-button danger-text" type="button" onClick={() => setArchiveCandidate(draft)}>{t('drafts.archive')}</button>
                  </>
                ) : <span className="status-label">{t('drafts.archive')}</span>}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {formOpen ? (
        <div className="editor-shell">
          <div className="editor-heading">
            <h3>{editing ? t('drafts.edit') : t('drafts.add')}</h3>
            <button className="text-button" type="button" onClick={() => setFormOpen(false)}>{t('common.close')}</button>
          </div>
          {formError ? <div className="notice error" role="alert">{t('common.error')}</div> : null}
          <div className="form-grid">
            <Field label={t('drafts.url')} wide><input required inputMode="url" type="url" value={form.url} onChange={(event) => setField(setForm, form, 'url', event.target.value)} /></Field>
            <Field label={t('drafts.titleEn')}><input required value={form.titleEn} onChange={(event) => setField(setForm, form, 'titleEn', event.target.value)} /></Field>
            <Field label={t('drafts.titleEs')}><input required value={form.titleEs} onChange={(event) => setField(setForm, form, 'titleEs', event.target.value)} /></Field>
            <Field label={t('drafts.summaryEn')}><textarea required value={form.summaryEn} onChange={(event) => setField(setForm, form, 'summaryEn', event.target.value)} /></Field>
            <Field label={t('drafts.summaryEs')}><textarea required value={form.summaryEs} onChange={(event) => setField(setForm, form, 'summaryEs', event.target.value)} /></Field>
            <Field label={t('drafts.icon')}>
              <select value={form.icon} onChange={(event) => setField(setForm, form, 'icon', event.target.value as StaffDraftIcon)}>
                {STAFF_DRAFT_ICONS.map((icon) => <option key={icon} value={icon}>{iconSymbol(icon)} {icon}</option>)}
              </select>
            </Field>
            <fieldset className="access-field">
              <legend>{t('drafts.access')}</legend>
              {(['public', 'clients'] as const).map((access) => (
                <label key={access}>
                  <input checked={form.access === access} name="draft-access" type="radio" value={access} onChange={() => setField(setForm, form, 'access', access)} />
                  <span>{access === 'public' ? t('drafts.public') : t('drafts.clients')}</span>
                </label>
              ))}
            </fieldset>
          </div>
          <div className="inline-actions end">
            <button className="button secondary" type="button" onClick={() => setFormOpen(false)}>{t('common.cancel')}</button>
            <button className="button primary" disabled={busy} type="button" onClick={() => void save()}>{t('drafts.save')}</button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={archiveCandidate !== null}
        title={t('drafts.archive')}
        confirmLabel={t('drafts.archive')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        onCancel={() => setArchiveCandidate(null)}
        onConfirm={() => void archive()}
      />
    </section>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}</span>{children}</label>;
}

function setField<Key extends keyof DraftForm>(
  setForm: React.Dispatch<React.SetStateAction<DraftForm>>,
  current: DraftForm,
  key: Key,
  value: DraftForm[Key],
): void {
  setForm({ ...current, [key]: value });
}

function toDraftInput(form: DraftForm): CatalogDraftInput {
  return validateDraftInput({
    url: form.url,
    title: { en: form.titleEn, 'es-MX': form.titleEs },
    summary: { en: form.summaryEn, 'es-MX': form.summaryEs },
    icon: form.icon,
    access: form.access,
  });
}

function iconSymbol(icon: StaffDraftIcon): string {
  return ({
    laboratory: '⌬',
    guide: '▤',
    nutrition: '❧',
    recipes: '⌁',
    wellness: '♡',
    location: '◇',
    contact: '▱',
    featured: '✦',
  })[icon];
}
