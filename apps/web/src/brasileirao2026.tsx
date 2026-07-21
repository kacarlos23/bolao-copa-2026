import {
  SeasonWorkspace,
  type SeasonWorkspaceSection,
} from './features/competitions/SeasonWorkspace';

/** Lightweight lazy-loading facade for the generic season workspace. */
export function SeasonCompetitionScreen({
  currentUserId,
  refreshVersion,
  section = 'all',
  onOpenTeam,
}: {
  currentUserId: string;
  refreshVersion: number;
  section?: SeasonWorkspaceSection;
  onOpenTeam?: (teamId: string) => void;
}) {
  return (
    <SeasonWorkspace
      currentUserId={currentUserId}
      refreshVersion={refreshVersion}
      section={section}
      onOpenTeam={onOpenTeam}
    />
  );
}
