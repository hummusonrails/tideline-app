import type { ArcadeContent } from '../../lib/arcade/content';
import type { PartyGameDef } from '../../lib/party/catalog';
import type { PartySession } from '../../lib/party/session';

/** What every party game is handed. */
export interface PartyGameProps {
  game: PartyGameDef;
  session: PartySession;
  content: ArcadeContent;
  /** Ends the game and shows the results card. */
  onFinish: () => void;
}
