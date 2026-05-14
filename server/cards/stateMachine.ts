import { conflict } from '../http/errors.js';

const transitions = {
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

export function transitionFor(action, currentStatus) {
  const transition = transitions[action];
  if (!transition) {
    throw conflict('INVALID_CARD_TRANSITION', 'Unsupported card transition.');
  }

  if (!transition.from.has(currentStatus)) {
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
