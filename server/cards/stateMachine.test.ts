import { describe, expect, it } from 'vitest';
import { transitionFor } from './stateMachine.js';

describe('transitionFor', () => {
  it('should transition from available to reserved', () => {
    const result = transitionFor('reserve', 'available');
    expect(result).toEqual({ status: 'reserved', action: 'card.reserve' });
  });

  it('should transition from reserved to available', () => {
    const result = transitionFor('unreserve', 'reserved');
    expect(result).toEqual({ status: 'available', action: 'card.unreserve' });
  });

  it('should transition from available to sold', () => {
    const result = transitionFor('sell', 'available');
    expect(result).toEqual({ status: 'sold', action: 'card.sell' });
  });

  it('should transition from reserved to sold', () => {
    const result = transitionFor('sell', 'reserved');
    expect(result).toEqual({ status: 'sold', action: 'card.sell' });
  });

  it('should transition from in_use to sold', () => {
    const result = transitionFor('sell', 'in_use');
    expect(result).toEqual({ status: 'sold', action: 'card.sell' });
  });

  it('should transition from sold to null (undo-sale)', () => {
    const result = transitionFor('undo-sale', 'sold');
    expect(result).toEqual({ status: null, action: 'card.undo_sale' });
  });

  it('should transition from available to null (use)', () => {
    const result = transitionFor('use', 'available');
    expect(result).toEqual({ status: null, action: 'card.use' });
  });

  it('should transition from in_use to null (use)', () => {
    const result = transitionFor('use', 'in_use');
    expect(result).toEqual({ status: null, action: 'card.use' });
  });

  it('should transition from available to void', () => {
    const result = transitionFor('void', 'available');
    expect(result).toEqual({ status: 'void', action: 'card.void' });
  });

  it('should transition from reserved to void', () => {
    const result = transitionFor('void', 'reserved');
    expect(result).toEqual({ status: 'void', action: 'card.void' });
  });

  it('should transition from in_use to void', () => {
    const result = transitionFor('void', 'in_use');
    expect(result).toEqual({ status: 'void', action: 'card.void' });
  });

  it('should transition from in_use to null (undo-usage)', () => {
    const result = transitionFor('undo-usage', 'in_use');
    expect(result).toEqual({ status: null, action: 'card.undo_usage' });
  });

  it('should transition from used_up to null (undo-usage)', () => {
    const result = transitionFor('undo-usage', 'used_up');
    expect(result).toEqual({ status: null, action: 'card.undo_usage' });
  });

  it('should throw conflict error for unsupported action', () => {
    expect(() => transitionFor('invalid-action', 'available')).toThrowError('Unsupported card transition.');
  });

  it('should throw conflict error for invalid status transition', () => {
    expect(() => transitionFor('reserve', 'reserved')).toThrowError('Cannot reserve a card with status reserved.');
  });
});
