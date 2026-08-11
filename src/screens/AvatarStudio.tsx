import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Lock, Check } from 'lucide-react';
import { GlassCard } from '../ui/GlassCard';
import { CrewAvatar } from '../ui/CrewAvatar';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { enqueue } from '../lib/sync';
import { textToBase64 } from '../lib/github';
import { avatarSpecPath } from '../lib/paths';
import { todayYMD } from '../lib/time';
import { useAvatarSpec, useUnlockState, useTierFor } from '../lib/avatar';
import {
  BASES, EYES, MOUTHS, HATS, ACCESSORIES, PALETTES,
  defaultSpecFor, isUnlocked, unlockHint,
  type Part, type Palette, type UnlockState,
} from '../lib/avatarCatalog';
import type { AvatarSpec } from '../types';

const MOODS = ['🤩', '😎', '😴', '🥶', '🤢', '🥳', '🧐', '😂', '🫠', '🐋'];

/**
 * Design your crew member.
 *
 * Edits apply to a local draft and are written on save, not on every tap: the
 * spec is a single mutable file, and committing one per tap would put a
 * hundred commits in the trip history for one afternoon of fiddling.
 */
export function AvatarStudio() {
  const navigate = useNavigate();
  const myId = useSession((s) => s.identity)!;
  const stored = useAvatarSpec(myId);
  const unlocks = useUnlockState(myId);
  const tier = useTierFor(myId);

  const [draft, setDraft] = useState<AvatarSpec | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed the draft once the stored spec resolves (undefined means "still
  // loading", so waiting avoids clobbering a synced look with a fresh default).
  useEffect(() => {
    if (draft !== null || stored === undefined) return;
    setDraft(
      stored ?? {
        memberId: myId,
        ...defaultSpecFor(myId),
        updatedAt: new Date().toISOString(),
      },
    );
  }, [stored, draft, myId]);

  const dirty = useMemo(() => {
    if (!draft) return false;
    if (!stored) return true;
    return (
      draft.base !== stored.base ||
      draft.palette !== stored.palette ||
      draft.eyes !== stored.eyes ||
      draft.mouth !== stored.mouth ||
      draft.hat !== stored.hat ||
      draft.accessory !== stored.accessory ||
      draft.mood?.emoji !== stored.mood?.emoji
    );
  }, [draft, stored]);

  if (!draft) {
    return <div className="min-h-dvh grid place-items-center text-ink-600">Loading…</div>;
  }

  const set = (patch: Partial<AvatarSpec>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setSaved(false);
  };

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await saveAvatarSpec({ ...draft, updatedAt: new Date().toISOString() });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh pb-28">
      <div className="pt-[max(env(safe-area-inset-top),1rem)] px-4">
        <header className="flex items-center gap-3 mb-5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="grid h-10 w-10 place-items-center rounded-full glass shrink-0"
            aria-label="Back"
          >
            <ChevronLeft size={20} strokeWidth={1.75} />
          </button>
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-600 font-medium">Avatar studio</div>
            <h1 className="font-display text-2xl font-semibold leading-tight">Your crew member</h1>
          </div>
        </header>

        <main className="space-y-5">
          <GlassCard className="text-center bg-gradient-to-b from-sage-100/70 to-white/50">
            <div className="flex justify-center">
              <CrewAvatar spec={draft} size={160} tier={tier} alt="Your crew avatar preview" />
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-xs text-ink-600">Today I'm feeling</span>
              {MOODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    set({
                      mood:
                        draft.mood?.emoji === m && draft.mood.date === todayYMD()
                          ? undefined
                          : { emoji: m, date: todayYMD() },
                    })
                  }
                  className={`grid h-8 w-8 place-items-center rounded-full text-base transition ${
                    draft.mood?.emoji === m ? 'bg-ink-900 scale-110' : 'bg-white/60'
                  }`}
                  aria-label={`Mood ${m}`}
                  aria-pressed={draft.mood?.emoji === m}
                >
                  {m}
                </button>
              ))}
            </div>
          </GlassCard>

          <PaletteRow
            value={draft.palette}
            unlocks={unlocks}
            onPick={(id) => set({ palette: id })}
          />
          <PartRow label="Creature" parts={BASES} value={draft.base} draftPalette={draft.palette}
                   unlocks={unlocks} onPick={(id) => set({ base: id })} />
          <PartRow label="Eyes" parts={EYES} value={draft.eyes} draftPalette={draft.palette}
                   unlocks={unlocks} onPick={(id) => set({ eyes: id })} base={draft.base} />
          <PartRow label="Mouth" parts={MOUTHS} value={draft.mouth} draftPalette={draft.palette}
                   unlocks={unlocks} onPick={(id) => set({ mouth: id })} base={draft.base} />
          <PartRow label="Hat" parts={HATS} value={draft.hat ?? 'none'} draftPalette={draft.palette}
                   unlocks={unlocks} onPick={(id) => set({ hat: id === 'none' ? undefined : id })} base={draft.base} />
          <PartRow label="Accessory" parts={ACCESSORIES} value={draft.accessory ?? 'none'} draftPalette={draft.palette}
                   unlocks={unlocks} onPick={(id) => set({ accessory: id === 'none' ? undefined : id })} base={draft.base} />

          <div className="text-xs text-ink-500 text-center px-6 leading-relaxed">
            Locked pieces unlock as you climb tiers, finish hunts and find
            secrets. Your look syncs to the family next time there's internet.
          </div>

          <button
            type="button"
            disabled={saving || (!dirty && saved) || (!dirty && !!stored)}
            onClick={() => void save()}
            className="w-full rounded-full bg-ink-900 text-white font-medium py-3.5 disabled:opacity-40 active:scale-[0.98] transition"
          >
            {saving ? 'Saving…' : saved && !dirty ? 'Saved ✓' : 'Save my crew member'}
          </button>
        </main>
      </div>
    </div>
  );
}

function PaletteRow({
  value, unlocks, onPick,
}: {
  value: string;
  unlocks: UnlockState;
  onPick: (id: string) => void;
}) {
  return (
    <section>
      <SectionLabel>Colour</SectionLabel>
      <div className="flex gap-3 overflow-x-auto scroll-clean -mx-4 px-4 pb-1">
        {PALETTES.map((p) => (
          <PaletteSwatch
            key={p.id}
            palette={p}
            selected={value === p.id}
            locked={!isUnlocked(p, unlocks)}
            onPick={() => onPick(p.id)}
          />
        ))}
      </div>
    </section>
  );
}

function PaletteSwatch({
  palette, selected, locked, onPick,
}: {
  palette: Palette;
  selected: boolean;
  locked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onPick}
      title={locked ? (unlockHint(palette) ?? undefined) : palette.label}
      className={`relative shrink-0 h-14 w-14 rounded-2xl transition ${
        selected ? 'ring-2 ring-ink-900 scale-105' : 'ring-1 ring-white/80'
      } ${locked ? 'opacity-45' : 'active:scale-95'}`}
      style={{ background: `linear-gradient(140deg, ${palette.body}, ${palette.belly})` }}
      aria-label={palette.label}
      aria-pressed={selected}
    >
      {locked && (
        <span className="absolute inset-0 grid place-items-center text-ink-900">
          <Lock size={14} />
        </span>
      )}
      {selected && !locked && (
        <span className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-ink-900 text-white">
          <Check size={11} />
        </span>
      )}
    </button>
  );
}

function PartRow({
  label, parts, value, draftPalette, unlocks, onPick, base,
}: {
  label: string;
  parts: readonly Part[];
  value: string;
  draftPalette: string;
  unlocks: UnlockState;
  onPick: (id: string) => void;
  /** Draw face parts over the current body so the preview reads correctly. */
  base?: string;
}) {
  return (
    <section>
      <SectionLabel>{label}</SectionLabel>
      <div className="flex gap-3 overflow-x-auto scroll-clean -mx-4 px-4 pb-1">
        {parts.map((part) => {
          const locked = !isUnlocked(part, unlocks);
          const hint = unlockHint(part);
          const previewSpec: AvatarSpec = {
            memberId: 'preview',
            base: base ?? part.id,
            palette: draftPalette,
            eyes: 'round',
            mouth: 'smile',
            updatedAt: '',
            ...(parts === BASES ? { base: part.id } : {}),
            ...(parts === EYES ? { eyes: part.id } : {}),
            ...(parts === MOUTHS ? { mouth: part.id } : {}),
            ...(parts === HATS ? { hat: part.id } : {}),
            ...(parts === ACCESSORIES ? { accessory: part.id } : {}),
          };
          return (
            <button
              key={part.id}
              type="button"
              disabled={locked}
              onClick={() => onPick(part.id)}
              className={`relative shrink-0 rounded-2xl p-1.5 transition ${
                value === part.id ? 'ring-2 ring-ink-900 bg-white/70' : 'ring-1 ring-white/70 bg-white/40'
              } ${locked ? 'opacity-45' : 'active:scale-95'}`}
              aria-label={locked && hint ? `${part.label} — ${hint}` : part.label}
              aria-pressed={value === part.id}
            >
              <CrewAvatar spec={previewSpec} size={52} alt="" />
              <div className="mt-1 text-[10px] text-ink-600 text-center max-w-[60px] truncate">
                {locked ? (hint ?? 'Locked') : part.label}
              </div>
              {locked && (
                <span className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-white/85 text-ink-900">
                  <Lock size={11} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-wider text-ink-600 mb-2 px-1 font-medium">
      {children}
    </div>
  );
}

/**
 * Persist a spec locally and queue the remote write.
 *
 * Single-writer mutable file: only this member ever writes this path, so
 * rewriting it in place is safe in a way that a shared document would not be.
 */
export async function saveAvatarSpec(spec: AvatarSpec): Promise<void> {
  await db.avatarSpecs.put(spec);
  await enqueue({
    // Stable id keyed by member, so repeated saves collapse into one pending
    // write instead of queueing a commit per fiddle.
    id: `avatar-spec-${spec.memberId}`,
    enqueuedAt: new Date().toISOString(),
    op: {
      kind: 'put-file',
      path: avatarSpecPath(spec.memberId),
      contentBase64: textToBase64(JSON.stringify(spec)),
      commitMessage: 'update crew avatar',
    },
  });
}
