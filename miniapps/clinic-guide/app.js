import { mountNetworkMotion } from '../shared/motion.js';
import { mountPageLifecycle, mountShell } from '../shared/shell.js';

const CHECKLIST_KEY = 'cabohealth.web.clinic-checklist.v1';
const CLINIC_PANELS = new Set(['explore', 'visit', 'contact']);

export function activateClinicPanel(page, name) {
  if (!CLINIC_PANELS.has(name)) return false;
  for (const panel of page.querySelectorAll('[data-clinic-panel]')) {
    const selected = panel.dataset.clinicPanel === name;
    panel.dataset.active = String(selected);
    panel.setAttribute('aria-hidden', String(!selected));
  }
  for (const tab of page.querySelectorAll('[data-clinic-tab]')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.clinicTab === name));
  }
  return true;
}

export function selectClinicPanel({ page, view, motion, name }) {
  if (!activateClinicPanel(page, name)) return false;
  const behavior = motion?.allowsAnimatedTransitions?.() === true ? 'smooth' : 'auto';
  view.scrollTo?.({ top: 0, behavior });
  return true;
}

function readCheckedItems(storage) {
  try {
    const stored = JSON.parse(storage.getItem(CHECKLIST_KEY) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function resetClinicChecklist({ checklistItems, checkedItems, storage, status, language }) {
  for (const item of checklistItems) item.checked = false;
  checkedItems.clear();
  try {
    storage.removeItem(CHECKLIST_KEY);
  } catch {
    // The visible checklist is still reset when persistence is unavailable.
  }
  status.textContent = language === 'es-MX' ? 'Lista restablecida.' : 'Checklist reset.';
  return true;
}

export function mountClinicGuide({ page, view, storage }) {
  const shell = mountShell({ document: page, storage });
  const motion = mountNetworkMotion({ document: page, language: shell.getLanguage });
  const checklistItems = [...page.querySelectorAll('[data-checklist-item]')];
  const resetControl = page.querySelector('[data-reset-checklist]');
  const resetStatus = page.querySelector('[data-checklist-status]');
  const panelControls = [...page.querySelectorAll('[data-clinic-tab], [data-open-clinic-panel]')];
  const listeners = new AbortController();
  const checkedItems = readCheckedItems(storage);

  for (const item of checklistItems) {
    item.checked = checkedItems.has(item.dataset.checklistItem);
    item.disabled = false;
    item.addEventListener('change', () => {
      if (resetStatus) resetStatus.textContent = '';
      if (item.checked) checkedItems.add(item.dataset.checklistItem);
      else checkedItems.delete(item.dataset.checklistItem);
      try {
        storage.setItem(CHECKLIST_KEY, JSON.stringify([...checkedItems].sort()));
      } catch {
        // The checklist remains usable for this visit without persistence.
      }
    }, { signal: listeners.signal });
  }

  if (resetControl && resetStatus) {
    resetControl.disabled = false;
    resetControl.addEventListener('click', () => {
      resetClinicChecklist({
        checklistItems,
        checkedItems,
        storage,
        status: resetStatus,
        language: shell.getLanguage(),
      });
    }, { signal: listeners.signal });
  }

  for (const control of panelControls) {
    control.disabled = false;
    control.addEventListener('click', () => {
      const name = control.dataset.clinicTab ?? control.dataset.openClinicPanel;
      selectClinicPanel({ page, view, motion, name });
    }, { signal: listeners.signal });
  }
  activateClinicPanel(page, 'explore');

  return mountPageLifecycle({ view, onDestroy: () => {
    listeners.abort();
    motion.destroy();
    shell.destroy();
  } });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  mountClinicGuide({ page: document, view: window, storage: window.localStorage });
}
