import {
  SeasonWorkspace,
  type SeasonWorkspaceSection,
} from './features/competitions/SeasonWorkspace';

/**
 * Compatibility facade kept while the Brasileirão canary and the generic
 * competition workspace run side by side.
 */
export function Brasileirao2026Screen({
  currentUserId,
  refreshVersion,
  section = 'all',
}: {
  currentUserId: string;
  refreshVersion: number;
  section?: SeasonWorkspaceSection;
}) {
  return (
    <SeasonWorkspace
      currentUserId={currentUserId}
      refreshVersion={refreshVersion}
      section={section}
    />
  );
}
