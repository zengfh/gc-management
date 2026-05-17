import type { CardStatus } from '../shared/domain';
import { statusText } from './display';

export function StatusBadge({ status }: { status: CardStatus | string }) {
  return <span className={`status-badge status-${status}`}>{statusText(status)}</span>;
}
