import type { ScoreType } from '@bolao/shared';
import { theme } from '../../theme/tokens';

export const predictionPresentation: Record<
  ScoreType,
  { label: string; shortLabel: string; backgroundColor: string; borderColor: string }
> = {
  EXACT_SCORE: {
    label: 'Placar exato',
    shortLabel: 'Exato',
    backgroundColor: 'rgba(52, 209, 123, 0.18)',
    borderColor: theme.color.accent,
  },
  RESULT: {
    label: 'Resultado correto',
    shortLabel: 'Resultado',
    backgroundColor: 'rgba(114, 183, 242, 0.18)',
    borderColor: theme.color.info,
  },
  ONE_TEAM_GOALS: {
    label: 'Gol de uma equipe',
    shortLabel: 'Um placar',
    backgroundColor: 'rgba(255, 166, 84, 0.18)',
    borderColor: '#ffa654',
  },
  MISS: {
    label: 'Palpite incorreto',
    shortLabel: 'Erro',
    backgroundColor: 'rgba(255, 136, 120, 0.18)',
    borderColor: theme.color.danger,
  },
};
