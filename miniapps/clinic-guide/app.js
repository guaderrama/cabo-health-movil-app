import { mountNetworkMotion } from '../shared/motion.js';
import { mountPageLifecycle, mountShell } from '../shared/shell.js';

const CHECKLIST_KEY = 'cabohealth.web.clinic-checklist.v1';
const page = document;
const shell = mountShell({ document: page, storage: window.localStorage });
const motion = mountNetworkMotion({ document: page, language: shell.getLanguage });
const checklistItems = [...page.querySelectorAll('[data-checklist-item]')];
const listeners = new AbortController();

function readCheckedItems() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CHECKLIST_KEY) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

const checkedItems = readCheckedItems();
for (const item of checklistItems) {
  item.checked = checkedItems.has(item.dataset.checklistItem);
  item.addEventListener('change', () => {
    if (item.checked) checkedItems.add(item.dataset.checklistItem);
    else checkedItems.delete(item.dataset.checklistItem);
    try {
      window.localStorage.setItem(CHECKLIST_KEY, JSON.stringify([...checkedItems].sort()));
    } catch {
      // The checklist remains usable for this visit without persistence.
    }
  }, { signal: listeners.signal });
}

mountPageLifecycle({ view: window, onDestroy: () => {
  listeners.abort();
  motion.destroy();
  shell.destroy();
} });
