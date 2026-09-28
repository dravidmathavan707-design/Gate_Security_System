import type { LateRequestHistoryItem } from '../services/api'

interface LateRequestHistoryListProps {
  entries: LateRequestHistoryItem[]
  emptyMessage: string
  showStudent?: boolean
}

function statusLabel(status: LateRequestHistoryItem['status']): string {
  if (status === 'pending_approval') return 'Waiting for approval'
  if (status === 'approved') return 'Approved'
  return 'Not approved'
}

function roleLabel(role: LateRequestHistoryItem['approved_by_role']): string {
  if (role === 'hod') return 'HOD'
  if (role === 'advisor') return 'Advisor'
  return 'Staff'
}

export function LateRequestHistoryList({
  entries,
  emptyMessage,
  showStudent = true,
}: LateRequestHistoryListProps) {
  if (entries.length === 0) {
    return <div className="late-history-empty">{emptyMessage}</div>
  }

  return (
    <div className="late-history-list">
      {entries.map((entry) => (
        <article className="late-history-item" key={entry.id}>
          <div className="late-history-heading">
            <div>
              <strong>{showStudent ? entry.student_name : `Late-entry request #${entry.id}`}</strong>
              <small>{showStudent
                ? [entry.student_identifier, entry.register_number].filter(Boolean).join(' · ') || `Student #${entry.student_id}`
                : `${entry.department_code} · ${entry.year ? `Year ${entry.year}` : 'Year unavailable'}${entry.section ? ` · Section ${entry.section}` : ''}`}</small>
            </div>
            <span className={`late-history-status is-${entry.status.replace('_', '-')}`}>{statusLabel(entry.status)}</span>
          </div>
          <p className="late-history-reason">{entry.reason}</p>
          <div className="late-history-meta">
            <span>{entry.department_code} · {entry.department_name}{entry.year ? ` · Year ${entry.year}` : ''}{entry.section ? ` · Section ${entry.section}` : ''}</span>
            <span>Sent {new Date(entry.requested_at).toLocaleString()}</span>
          </div>
          <div className="late-history-reviewers">
            <span>Advisor · {entry.advisor_name ?? 'Unassigned'}</span>
            <span>HOD · {entry.hod_name ?? 'Unassigned'}</span>
            {entry.approved_by_name && (
              <span className="late-history-decision">Decision · {entry.approved_by_name} ({roleLabel(entry.approved_by_role)})</span>
            )}
          </div>
          {entry.decision_note && <p className="late-history-note">Staff note: {entry.decision_note}</p>}
        </article>
      ))}
    </div>
  )
}