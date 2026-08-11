/**
 * Like for Like — the Judge turns over a describing word and everybody plays
 * the thing it fits best.
 *
 * The same engine as Blank Sea with the halves swapped: there the prompt is a
 * sentence and the cards are answers, here the prompt is one adjective and
 * the cards are nouns. Arguing with the Judge is the point of the game and
 * costs nothing, which is why the reveal is one card at a time.
 */

import { useCallback } from 'react';
import { JudgePickGame, dealCards, type JudgeDeckRound } from './judgePick';
import { LIKE_ADJECTIVES, LIKE_NOUNS } from '../../../lib/party/decks';
import { pick } from '../../../lib/arcade/rng';
import type { PartyGameProps } from '../shared';

const HAND = 6;

export default function LikeForLike(props: PartyGameProps) {
  const buildRound = useCallback(
    (_round: number, answerers: number, rng: () => number): JudgeDeckRound => ({
      promptLabel: 'Best match wins',
      prompt: pick(LIKE_ADJECTIVES, rng).toUpperCase(),
      hand: dealCards(LIKE_NOUNS, answerers * HAND, rng),
    }),
    [],
  );

  return <JudgePickGame {...props} buildRound={buildRound} handSize={HAND} />;
}
