import { useNavigate } from 'react-router-dom';
import type { RoutePoint } from '../types';

/**
 * The trip as a hand-drawn line with a dot per stop.
 *
 * Not a real map. Real maps mean tiles — tens of megabytes to cache, or a
 * network request that fails at sea. A hand-authored polyline in the trip data
 * is about 2KB, always works offline, and answers the only question anyone
 * actually asks: where are we, and what's next.
 *
 * Coordinates live in the private trip data (`config/route.json`), so the
 * public app carries no information about where anyone is going. With no route
 * configured, this renders nothing.
 */
export function RouteMap({
  points,
  visitedSlugs,
  currentSlug,
}: {
  points: readonly RoutePoint[];
  visitedSlugs: ReadonlySet<string>;
  currentSlug?: string;
}) {
  const navigate = useNavigate();
  if (points.length < 2) return null;

  const path = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="glass rounded-[28px] p-4">
      <svg
        viewBox="0 0 100 100"
        className="w-full h-auto"
        role="img"
        aria-label={`Route with ${points.length} stops`}
      >
        <polyline
          points={path}
          fill="none"
          stroke="var(--color-sage-300)"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="3 2"
        />
        {points.map((p) => {
          const visited = visitedSlugs.has(p.slug);
          const isCurrent = p.slug === currentSlug;
          return (
            <g key={p.slug}>
              {isCurrent && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="4.5"
                  fill="var(--color-ocean)"
                  opacity="0.25"
                  className="animate-pulse"
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r="2.2"
                fill={isCurrent ? 'var(--color-ocean)' : visited ? 'var(--color-sage-500)' : 'white'}
                stroke={visited || isCurrent ? 'none' : 'var(--color-sage-300)'}
                strokeWidth="0.8"
                // Generous invisible hit area: 2.2 SVG units is a few pixels.
                className="cursor-pointer"
                onClick={() => navigate(`/place/${p.slug}`)}
              />
              <circle
                cx={p.x}
                cy={p.y}
                r="6"
                fill="transparent"
                onClick={() => navigate(`/place/${p.slug}`)}
              />
              {p.label && (
                <text
                  x={p.x}
                  y={p.y - 4}
                  textAnchor="middle"
                  className="fill-ink-600"
                  style={{ fontSize: '3.2px' }}
                >
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
