import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CATALOG_ITEM_ICONS,
  createCatalogItemModel,
  isCatalogRevisionConflict,
  validateCatalogItemDetails,
  validateCatalogItemInput,
  type CatalogItem,
  type CatalogItemAccess,
  type CatalogItemGateway,
  type CatalogItemIcon,
} from '../domain/catalogItems.js';
import type { StaffLanguage, StaffMessageKey } from '../i18n/messages.js';
import { ConfirmDialog } from './ConfirmDialog.js';

interface MiniappCatalogPanelProps {
  readonly gateway: CatalogItemGateway;
  readonly language: StaffLanguage;
  readonly t: (key: StaffMessageKey) => string;
}

interface MiniappForm {
  readonly access: CatalogItemAccess;
  readonly active: boolean;
  readonly icon: CatalogItemIcon;
  readonly summaryEn: string;
  readonly summaryEs: string;
  readonly titleEn: string;
  readonly titleEs: string;
  readonly url: string;
}

type OperationError = 'conflict' | 'failed' | null;

const EMPTY_FORM: MiniappForm = Object.freeze({
  access: 'public' as CatalogItemAccess,
  active: true,
  icon: 'guide' as CatalogItemIcon,
  summaryEn: '',
  summaryEs: '',
  titleEn: '',
  titleEs: '',
  url: '',
});

export function MiniappCatalogPanel({ gateway, language, t }: MiniappCatalogPanelProps) {
  const model = useMemo(() => createCatalogItemModel(gateway), [gateway]);
  const [items, setItems] = useState<readonly CatalogItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<MiniappForm>(EMPTY_FORM);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<CatalogItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState<OperationError>(null);
  const operationRef = useRef(false);

  const beginOperation = () => {
    if (operationRef.current) return false;
    operationRef.current = true;
    setBusy(true);
    return true;
  };
  const endOperation = () => {
    operationRef.current = false;
    setBusy(false);
  };

  const sync = () => setItems(model.getSnapshot().items);
  const load = async () => {
    if (!beginOperation()) return;
    setOperationError(null);
    try {
      await model.load();
      sync();
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setLoaded(true);
      endOperation();
    }
  };

  useEffect(() => { void load(); }, [model]);

  const startNew = () => {
    if (operationRef.current) return;
    setEditing(null);
    setForm(EMPTY_FORM);
    setOperationError(null);
    setFormOpen(true);
  };

  const startEdit = (item: CatalogItem) => {
    if (operationRef.current) return;
    setEditing(item);
    setForm({
      access: item.access,
      active: item.active,
      icon: item.icon,
      summaryEn: item.summary.en,
      summaryEs: item.summary['es-MX'],
      titleEn: item.title.en,
      titleEs: item.title['es-MX'],
      url: item.url,
    });
    setOperationError(null);
    setFormOpen(true);
  };

  const save = async () => {
    if (!beginOperation()) return;
    setOperationError(null);
    try {
      const details = validateCatalogItemDetails({
        access: form.access,
        icon: form.icon,
        summary: { en: form.summaryEn, 'es-MX': form.summaryEs },
        title: { en: form.titleEn, 'es-MX': form.titleEs },
        url: form.url,
      });
      if (editing) {
        await model.update(editing.id, editing.revision, details);
      } else {
        await model.create(validateCatalogItemInput({ ...details, active: form.active }));
      }
      sync();
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (error) {
      setOperationError(isCatalogRevisionConflict(error) ? 'conflict' : 'failed');
    } finally {
      endOperation();
    }
  };

  const toggleActive = async (item: CatalogItem) => {
    if (!beginOperation()) return;
    setOperationError(null);
    try {
      await model.setActive(item.id, item.revision, !item.active);
      sync();
    } catch (error) {
      setOperationError(isCatalogRevisionConflict(error) ? 'conflict' : 'failed');
    } finally {
      endOperation();
    }
  };

  const deleteItem = async () => {
    if (!deleteCandidate || !beginOperation()) return;
    setOperationError(null);
    try {
      await model.delete(deleteCandidate.id, deleteCandidate.revision);
      sync();
      setDeleteCandidate(null);
    } catch (error) {
      setOperationError(isCatalogRevisionConflict(error) ? 'conflict' : 'failed');
    } finally {
      endOperation();
    }
  };

  const reloadAfterConflict = () => {
    if (operationRef.current) return;
    setFormOpen(false);
    setEditing(null);
    setDeleteCandidate(null);
    void load();
  };

  return (
    <section aria-labelledby="miniapps-title" className="workspace-panel">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">{t('miniapps.eyebrow')}</p>
          <h2 id="miniapps-title">{t('miniapps.title')}</h2>
          <p>{t('miniapps.subtitle')}</p>
        </div>
        {!unavailable ? <button className="button primary" disabled={busy} type="button" onClick={startNew}>{t('miniapps.add')}</button> : null}
      </header>

      <div className="notice immediate-publish catalog-rule" role="note">
        <div>
          <strong>{t('miniapps.immediate')}</strong>
          <p>{t('miniapps.appleRule')}</p>
        </div>
      </div>

      {operationError ? (
        <div className="notice error" role="alert">
          <span>{t(operationError === 'conflict' ? 'miniapps.conflict' : 'miniapps.failed')}</span>
          {operationError === 'conflict' ? <button className="text-button" disabled={busy} type="button" onClick={reloadAfterConflict}>{t('miniapps.reload')}</button> : null}
        </div>
      ) : null}

      {unavailable ? (
        <div className="notice warning" role="status">
          <span>{t('miniapps.unavailable')}</span>
          <button className="text-button" disabled={busy} type="button" onClick={() => void load()}>{t('common.retry')}</button>
        </div>
      ) : null}

      {!loaded && !unavailable ? <p aria-live="polite">{t('common.loading')}</p> : null}
      {loaded && !unavailable && items.length === 0 ? <p className="empty-state">{t('miniapps.empty')}</p> : null}
      {loaded && !unavailable && items.length > 0 ? (
        <div className="miniapp-list">
          {items.map((item) => (
            <article className={item.active ? 'miniapp-row active' : 'miniapp-row'} key={item.id}>
              <span className="miniapp-icon" aria-hidden="true">{iconSymbol(item.icon)}</span>
              <div>
                <div className="miniapp-labels">
                  <span className="eyebrow">{item.access === 'clients' ? t('miniapps.clients') : t('miniapps.public')}</span>
                  <span className={item.active ? 'status-pill active' : 'status-pill'}>{item.active ? t('miniapps.active') : t('miniapps.inactive')}</span>
                </div>
                <h3>{item.title[language]}</h3>
                <p>{item.summary[language]}</p>
                <a href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a>
              </div>
              <div className="row-actions">
                <button className="text-button" disabled={busy} type="button" onClick={() => startEdit(item)}>{t('miniapps.edit')}</button>
                <button
                  aria-checked={item.active}
                  className="catalog-toggle"
                  disabled={busy}
                  role="switch"
                  type="button"
                  onClick={() => void toggleActive(item)}
                >
                  <span aria-hidden="true" />
                  {item.active ? t('miniapps.deactivate') : t('miniapps.activate')}
                </button>
                <button className="text-button danger-text" disabled={busy} type="button" onClick={() => setDeleteCandidate(item)}>{t('miniapps.delete')}</button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {formOpen ? (
        <div className="editor-shell">
          <div className="editor-heading">
            <h3>{editing ? t('miniapps.edit') : t('miniapps.add')}</h3>
            <button className="text-button" disabled={busy} type="button" onClick={() => setFormOpen(false)}>{t('common.close')}</button>
          </div>
          <div className="form-grid">
            <Field label={t('miniapps.url')} wide>
              <input disabled={busy || editing !== null} required inputMode="url" type="url" value={form.url} onChange={(event) => setField(setForm, form, 'url', event.target.value)} />
              <small className="field-help">{t(editing ? 'miniapps.urlLocked' : 'miniapps.urlHelp')}</small>
            </Field>
            <Field label={t('miniapps.titleEn')}><input disabled={busy} required value={form.titleEn} onChange={(event) => setField(setForm, form, 'titleEn', event.target.value)} /></Field>
            <Field label={t('miniapps.titleEs')}><input disabled={busy} required value={form.titleEs} onChange={(event) => setField(setForm, form, 'titleEs', event.target.value)} /></Field>
            <Field label={t('miniapps.summaryEn')}><textarea disabled={busy} required value={form.summaryEn} onChange={(event) => setField(setForm, form, 'summaryEn', event.target.value)} /></Field>
            <Field label={t('miniapps.summaryEs')}><textarea disabled={busy} required value={form.summaryEs} onChange={(event) => setField(setForm, form, 'summaryEs', event.target.value)} /></Field>
            <Field label={t('miniapps.icon')}>
              <select disabled={busy} value={form.icon} onChange={(event) => setField(setForm, form, 'icon', event.target.value as CatalogItemIcon)}>
                {CATALOG_ITEM_ICONS.map((icon) => <option key={icon} value={icon}>{iconSymbol(icon)} {icon}</option>)}
              </select>
            </Field>
            <fieldset className="access-field" disabled={busy}>
              <legend>{t('miniapps.access')}</legend>
              {(['public', 'clients'] as const).map((access) => (
                <label key={access}>
                  <input checked={form.access === access} name="miniapp-access" type="radio" value={access} onChange={() => setField(setForm, form, 'access', access)} />
                  <span>{access === 'public' ? t('miniapps.public') : t('miniapps.clients')}</span>
                </label>
              ))}
            </fieldset>
            {!editing ? (
              <label className="active-create-field">
                <input checked={form.active} disabled={busy} type="checkbox" onChange={(event) => setField(setForm, form, 'active', event.target.checked)} />
                <span><strong>{t('miniapps.createActive')}</strong><small>{t('miniapps.createActiveHelp')}</small></span>
              </label>
            ) : null}
          </div>
          <div className="inline-actions end">
            <button className="button secondary" disabled={busy} type="button" onClick={() => setFormOpen(false)}>{t('common.cancel')}</button>
            <button className="button primary" disabled={busy} type="button" onClick={() => void save()}>{busy ? t('common.loading') : t('miniapps.save')}</button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteCandidate !== null}
        title={t('miniapps.deleteConfirm').replace('{title}', deleteCandidate?.title[language] ?? '')}
        confirmLabel={t('miniapps.deletePermanently')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        onCancel={() => { if (!busy) setDeleteCandidate(null); }}
        onConfirm={() => void deleteItem()}
      />
    </section>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}</span>{children}</label>;
}

function setField<Key extends keyof MiniappForm>(
  setForm: React.Dispatch<React.SetStateAction<MiniappForm>>,
  current: MiniappForm,
  key: Key,
  value: MiniappForm[Key],
): void {
  setForm({ ...current, [key]: value });
}

function iconSymbol(icon: CatalogItemIcon): string {
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
