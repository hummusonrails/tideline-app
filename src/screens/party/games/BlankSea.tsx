/**
 * Blank Sea — a sentence with a hole in it, and the Judge decides who filled
 * it best.
 *
 * Prompts carry `{place}`, `{crew}` and `{plan}` tokens that resolve against
 * the synced trip, so the cards start naming actual stops and actual people a
 * few days in. They read perfectly well before that too.
 */

import { useCallback } from 'react';
import { JudgePickGame, dealCards, type JudgeDeckRound } from './judgePick';
import { BLANK_ANSWERS, BLANK_PROMPTS, fillTokens } from '../../../lib/party/decks';
import { pick } from '../../../lib/arcade/rng';
import type { PartyGameProps } from '../shared';

const HAND = 5;

export default function BlankSea(props: PartyGameProps) {
  const { content } = props;

  const buildRound = useCallback(
    (_round: number, answerers: number, rng: () => number): JudgeDeckRound => ({
      promptLabel: 'Fill the blank',
      prompt: fillTokens(pick(BLANK_PROMPTS, rng), content, rng),
      hand: dealCards(BLANK_ANSWERS, answerers * HAND, rng),
    }),
    [content],
  );

  return <JudgePickGame {...props} buildRound={buildRound} handSize={HAND} />;
}
