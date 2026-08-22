import { useEffect, useMemo, useState } from 'react';

import {
  createAuditModel,
  type AuditGateway,
  type StaffAuditAction,
  type StaffAuditEvent,
} from '../domain/auditLog.js';
import type { StaffLanguage, StaffMessageKey } from '../i18n/messages.js';

interface AuditPanelProps {
  readonly gateway: AuditGateway;
  readonly language: StaffLanguage;
  readonly t: (key: StaffMessageKey) => string;
}

export function AuditPanel({ gateway, language, t }: AuditPanelProps) {
  const model = useMemo(() => createAuditModel(gateway), [gateway]);
  const [events, setEvents] = useState<readonly StaffAuditEvent[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  const load = async () => {
    try {
      await model.load();
      setEvents(model.getSnapshot().events);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  };

  useEffect(() => { void load(); }, [model]);

  return (
    <section aria-labelledby="audit-title" className="workspace-panel">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">Read-only ledger</p>
          <h2 id="audit-title">{t('audit.title')}</h2>
          <p>{t('audit.subtitle')}</p>
        </div>
      </header>

      {unavailable ? (
        <div className="notice warning" role="status">
          <span>{t('audit.unavailable')}</span>
          <button className="text-button" type="button" onClick={() => void load()}>{t('common.retry')}</button>
        </div>
      ) : null}

      {!unavailable && events.length === 0 ? <p className="empty-state">{t('audit.empty')}</p> : null}
      {!unavailable && events.length > 0 ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">{t('audit.actor')}</th>
                <th scope="col">{t('audit.target')}</th>
                <th scope="col">{t('audit.time')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.eventId}>
                  <td><span className={`outcome-dot ${event.outcome}`} aria-hidden="true" />{formatAction(event.action)}</td>
                  <td>{event.actorLabel}</td>
                  <td>{event.targetSuffix}</td>
                  <td>{new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(event.occurredAtMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function formatAction(action: StaffAuditAction): string {
  return action.split('.').map((part) => part.replaceAll('_', ' ')).join(' · ');
}
