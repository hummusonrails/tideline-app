/**
 * The route that mounts one cabinet.
 *
 * Every game is lazily imported. Twenty games in the main bundle would slow
 * the first paint of a travel app for a feature most sessions never open —
 * and because the service worker precaches every emitted chunk, the split
 * costs nothing offline: the code is already on the phone before the plane
 * leaves.
 */

import { Suspense, lazy, type ComponentType } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { gameById, hueColor, type ArcadeGame as ArcadeGameDef } from '../lib/arcade/catalog';
import { useArcadeRun } from '../lib/arcade/run';
import { useArcadeContent } from '../lib/arcade/content';
import { GameShell } from '../ui/arcade/GameShell';
import type { GameProps } from './arcade/shared';

const GAME_COMPONENTS: Record<string, ComponentType<GameProps>> = {
  'crew-invaders': lazy(() => import('./arcade/games/CrewInvaders')),
  'block-tide': lazy(() => import('./arcade/games/BlockTide')),
  'sea-snake': lazy(() => import('./arcade/games/SeaSnake')),
  'port-breaker': lazy(() => import('./arcade/games/PortBreaker')),
  'tide-pong': lazy(() => import('./arcade/games/TidePong')),
  'asteroid-drift': lazy(() => import('./arcade/games/AsteroidDrift')),
  gangway: lazy(() => import('./arcade/games/Gangway')),
  'flappy-puffin': lazy(() => import('./arcade/games/FlappyPuffin')),
  'maze-muncher': lazy(() => import('./arcade/games/MazeMuncher')),
  'whack-a-crab': lazy(() => import('./arcade/games/WhackACrab')),
  'sonar-says': lazy(() => import('./arcade/games/SonarSays')),
  'crew-match': lazy(() => import('./arcade/games/CrewMatch')),
  hangman: lazy(() => import('./arcade/games/Hangman')),
  'tide-search': lazy(() => import('./arcade/games/TideSearch')),
  scramble: lazy(() => import('./arcade/games/Scramble')),
  'family-quiz': lazy(() => import('./arcade/games/FamilyQuiz')),
  'time-machine': lazy(() => import('./arcade/games/TimeMachine')),
  'tide-2048': lazy(() => import('./arcade/games/Tide2048')),
  'reef-sweeper': lazy(() => import('./arcade/games/ReefSweeper')),
  'ad-lib': lazy(() => import('./arcade/games/AdLib')),
};

export function ArcadeGame() {
  const { gameId } = useParams();
  const game = gameById(gameId);
  // An unknown id is a stale bookmark or a mistyped hash, not an error worth
  // a screen — send them back to the floor.
  if (!game) return <Navigate to="/arcade" replace />;
  return <Cabinet game={game} />;
}

/**
 * Split from the route so the hooks below always run. `useArcadeRun` needs a
 * game, and a component that returns early before its hooks is a rules
 * violation waiting to bite on the next edit.
 */
function Cabinet({ game }: { game: ArcadeGameDef }) {
  const run = useArcadeRun(game);
  const content = useArcadeContent();
  const Game = GAME_COMPONENTS[game.id];

  return (
    <GameShell run={run}>
      {Game ? (
        <Suspense fallback={<Booting color={hueColor(game.hue)} />}>
          <Game run={run} content={content} />
        </Suspense>
      ) : (
        <Booting color={hueColor(game.hue)} />
      )}
    </GameShell>
  );
}

function Booting({ color }: { color: string }) {
  return (
    <div className="grid aspect-[3/4] w-full place-items-center">
      <span
        className="blink text-[10px] uppercase tracking-[0.3em]"
        style={{ color }}
      >
        Loading cabinet…
      </span>
    </div>
  );
}
