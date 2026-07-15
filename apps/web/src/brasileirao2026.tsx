import { SeasonWorkspace } from './features/competitions/SeasonWorkspace';

/**
 * Compatibility facade kept while the Brasileirão canary and the generic
 * competition workspace run side by side.
 */
export function Brasileirao2026Screen({
  currentUserId,
  refreshVersion,
}: {
  currentUserId: string;
  refreshVersion: number;
}) {
  return <SeasonWorkspace currentUserId={currentUserId} refreshVersion={refreshVersion} />;
}
