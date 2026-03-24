import type { RoundStatus } from '../features/rounds/types';

interface StatusBadgeProps {
  status: RoundStatus;
}

const STATUS_LABELS: Record<RoundStatus, string> = {
  waiting_for_attempt: 'Waiting for attempt',
  attempted: 'Attempted',
  complete: 'Complete',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`badge ${status}`}>{STATUS_LABELS[status]}</span>;
}
