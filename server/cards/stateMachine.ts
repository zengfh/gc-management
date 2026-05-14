import { conflict } from '../http/errors.js';

type CardTransitionAction = 'reserve' | 'unreserve' | 'sell' | 'undo-sale' | 'use' | 'void' | 'undo-usage';
type CardStatus = 'available' | 'reserved' | 'in_use' | 'sold' | 'used_up' | 'void';

interface CardTransitionDefinition {
  from: Set<CardStatus>;
  to: CardStatus | null;
  action: string;
}

const transitions: Record<CardTransitionAction, CardTransitionDefinition> = {
  reserve: {
    from: new Set(['available']),
    to: 'reserved',
    action: 'card.reserve',
  },
  unreserve: {
    from: new Set(['reserved']),
    to: 'available',
    action: 'card.unreserve',
  },
  sell: {
    from: new Set(['available', 'reserved', 'in_use']),
    to: 'sold',
    action: 'card.sell',
  },
  'undo-sale': {
    from: new Set(['sold']),
    to: null,
    action: 'card.undo_sale',
  },
  use: {
    from: new Set(['available', 'in_use']),
    to: null,
    action: 'card.use',
  },
  void: {
    from: new Set(['available', 'reserved', 'in_use']),
    to: 'void',
    action: 'card.void',
  },
  'undo-usage': {
    from: new Set(['in_use', 'used_up']),
    to: null,
    action: 'card.undo_usage',
  },
};

export function transitionFor(action: string, currentStatus: CardStatus | string) {
  if (!isTransitionAction(action)) {
    throw conflict('INVALID_CARD_TRANSITION', 'Unsupported card transition.');
  }
  const transition = transitions[action];

  if (!transition.from.has(currentStatus as CardStatus)) {
    throw conflict(
      'INVALID_CARD_TRANSITION',
      `Cannot ${action} a card with status ${currentStatus}.`,
    );
  }

  return {
    status: transition.to,
    action: transition.action,
  };
}

function isTransitionAction(action: string): action is CardTransitionAction {
  return Object.prototype.hasOwnProperty.call(transitions, action);
}
