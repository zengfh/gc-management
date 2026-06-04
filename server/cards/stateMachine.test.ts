import { describe, expect, it } from 'vitest';
import { transitionFor } from './stateMachine.js';

describe('transitionFor', () => {
  it('transitions from available to reserved', () => {
    expect(transitionFor('reserve', 'available')).toEqual({
      status: 'reserved',
      action: 'card.reserve',
    });
  });

  it('transitions from reserved to available', () => {
    expect(transitionFor('unreserve', 'reserved')).toEqual({
      status: 'available',
      action: 'card.unreserve',
    });
  });

  it('transitions sellable statuses to sold', () => {
    expect(transitionFor('sell', 'available')).toEqual({ status: 'sold', action: 'card.sell' });
    expect(transitionFor('sell', 'reserved')).toEqual({ status: 'sold', action: 'card.sell' });
    expect(transitionFor('sell', 'in_use')).toEqual({ status: 'sold', action: 'card.sell' });
  });

  it('supports undoing a sale', () => {
    expect(transitionFor('undo-sale', 'sold')).toEqual({
      status: null,
      action: 'card.undo_sale',
    });
  });

  it('supports usage from available and in-use cards', () => {
    expect(transitionFor('use', 'available')).toEqual({ status: null, action: 'card.use' });
    expect(transitionFor('use', 'in_use')).toEqual({ status: null, action: 'card.use' });
  });

  it('transitions voidable statuses to void', () => {
    expect(transitionFor('void', 'available')).toEqual({ status: 'void', action: 'card.void' });
    expect(transitionFor('void', 'reserved')).toEqual({ status: 'void', action: 'card.void' });
    expect(transitionFor('void', 'in_use')).toEqual({ status: 'void', action: 'card.void' });
  });

  it('supports undoing usage from in-use and used-up cards', () => {
    expect(transitionFor('undo-usage', 'in_use')).toEqual({
      status: null,
      action: 'card.undo_usage',
    });
    expect(transitionFor('undo-usage', 'used_up')).toEqual({
      status: null,
      action: 'card.undo_usage',
    });
  });

  it('rejects unsupported actions', () => {
    expect(() => transitionFor('invalid-action', 'available')).toThrowError('Unsupported card transition.');
  });

  it('rejects invalid status transitions', () => {
    expect(() => transitionFor('reserve', 'reserved')).toThrowError(
      'Cannot reserve a card with status reserved.',
    );
  });
});
