import { describe, expect, it } from 'vitest';
import { deliveryLabel, deliveryState } from './delivery';

const base = { queued: false, online: true, deliveredTo: 0, seenByAnyone: false };

describe('deliveryState', () => {
  it('is sending while queued with a route out', () => {
    expect(deliveryState({ ...base, queued: true })).toBe('sending');
  });

  it('is saved-on-phone while queued with no route out', () => {
    expect(deliveryState({ ...base, queued: true, online: false })).toBe('saved');
  });

  it('is sent once the queue has drained', () => {
    expect(deliveryState(base)).toBe('sent');
  });

  it('prefers delivered over sent when a peer has it', () => {
    expect(deliveryState({ ...base, deliveredTo: 1 })).toBe('delivered');
  });

  it('reports delivered even while the upload is still queued', () => {
    // Reaching another phone at sea matters more than reaching GitHub.
    expect(deliveryState({ ...base, queued: true, online: false, deliveredTo: 2 })).toBe('delivered');
  });

  it('prefers seen over every transport state', () => {
    expect(deliveryState({ queued: true, online: false, deliveredTo: 3, seenByAnyone: true })).toBe('seen');
  });
});

describe('deliveryLabel', () => {
  it('reassures rather than alarms when there is no connectivity', () => {
    expect(deliveryLabel('saved')).toBe('Saved on this phone');
  });

  it('singularises one phone', () => {
    expect(deliveryLabel('delivered', 1)).toBe('Delivered to 1 phone');
  });

  it('pluralises several phones', () => {
    expect(deliveryLabel('delivered', 3)).toBe('Delivered to 3 phones');
  });

  it('has wording for every state', () => {
    for (const s of ['sending', 'saved', 'sent', 'delivered', 'seen'] as const) {
      expect(deliveryLabel(s, 1)).toBeTruthy();
    }
  });
});
