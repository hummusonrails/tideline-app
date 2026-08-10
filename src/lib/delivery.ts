/**
 * What to tell someone about a message they just sent.
 *
 * There's no server to ask, so "delivered" has to be assembled from what this
 * device happens to know: whether the upload is still queued, whether we can
 * reach the backend at all, and which peers have echoed the message back to us
 * in a HAVE. That makes the honest states different from a normal chat app's —
 * in particular "saved on this phone" is a real, common, and reassuring state
 * here, not an error.
 *
 * Pure so the wording rules can be tested without a database.
 */

export type DeliveryState =
  /** Write is still in the outbox and we have internet — going out now. */
  | 'sending'
  /** No route to the backend. It's safe locally and will go when there is one. */
  | 'saved'
  /** Uploaded to the backend. */
  | 'sent'
  /** Reached at least one other device directly. */
  | 'delivered'
  /** Someone has it open right now. */
  | 'seen';

export interface DeliveryInputs {
  /** Is this message still sitting in the outbox? */
  queued: boolean;
  /** Can we currently reach the backend? */
  online: boolean;
  /** How many peer devices have acknowledged holding it. */
  deliveredTo: number;
  /** Is a connected peer looking at it right now? */
  seenByAnyone: boolean;
}

export function deliveryState(inputs: DeliveryInputs): DeliveryState {
  // Strongest evidence first: a human reading it beats any transport fact.
  if (inputs.seenByAnyone) return 'seen';
  if (inputs.deliveredTo > 0) return 'delivered';
  if (inputs.queued) return inputs.online ? 'sending' : 'saved';
  return 'sent';
}

export function deliveryLabel(state: DeliveryState, deliveredTo = 0): string {
  switch (state) {
    case 'sending':   return 'Sending…';
    case 'saved':     return 'Saved on this phone';
    case 'sent':      return 'Sent';
    case 'delivered': return deliveredTo === 1 ? 'Delivered to 1 phone' : `Delivered to ${deliveredTo} phones`;
    case 'seen':      return 'Seen';
  }
}
