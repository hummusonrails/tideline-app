import { Link } from 'react-router-dom';
import { Crown } from 'lucide-react';
import { hueColor, type ArcadeGame } from '../../lib/arcade/catalog';
import { sfx } from '../../lib/arcade/sound';

/**
 * One machine on the floor.
 *
 * The two numbers on a cabinet are chosen for what they make you do: your own
 * best is there so you can beat it, and the house record is there with a name
 * on it so you know who to beat. A cabinet nobody has played says so, which
 * is its own kind of invitation.
 */
export function Cabinet({
  game,
  yourBest,
  topScore,
  topName,
  youHoldIt,
}: {
  game: ArcadeGame;
  yourBest: number;
  topScore: number;
  topName: string | null;
  youHoldIt: boolean;
}) {
  const color = hueColor(game.hue);
  return (
    <Link
      to={`/arcade/${game.id}`}
      onClick={() => sfx.coin()}
      className="cab-tile block rounded-xl p-3 text-left"
      style={{ ['--cab-hue' as string]: String(game.hue) }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl leading-none" aria-hidden>
          {game.glyph}
        </span>
        {youHoldIt && (
          <Crown size={14} style={{ color: 'var(--neon-gold)' }} aria-label="You hold the record" />
        )}
      </div>

      <h3
        className="neon-soft mt-2 text-[11px] font-bold uppercase leading-tight tracking-[0.12em]"
        style={{ color }}
      >
        {game.title}
      </h3>

      <div className="mt-2 space-y-0.5 text-[9px] uppercase tracking-wider" style={{ color: 'var(--cab-dim)' }}>
        {yourBest > 0 ? (
          <div>
            You <span className="tabular font-bold" style={{ color: 'var(--cab-text)' }}>{yourBest.toLocaleString()}</span>
          </div>
        ) : (
          <div className="blink" style={{ color: 'var(--neon-gold)' }}>
            Not played
          </div>
        )}
        {topScore > 0 ? (
          <div className="truncate">
            Best {topName ?? '???'}{' '}
            <span className="tabular font-bold" style={{ color: 'var(--neon-gold)' }}>
              {topScore.toLocaleString()}
            </span>
          </div>
        ) : (
          <div>Record open</div>
        )}
      </div>
    </Link>
  );
}
