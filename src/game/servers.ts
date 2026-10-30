import { SIZE_INFO, type LevelId, type MapSize } from './types';

/** Display names for the built-in arenas (and the procedural category). */
export const MAP_NICE: Record<LevelId, string> = {
  plaza: 'Neon Plaza',
  yard: 'Container Yard',
  skyline: 'Skyline District',
  colosseum: 'The Colosseum',
  procedural: 'Procedural',
};

/** Human label for a server's map, e.g. "Procedural · Large". */
export function levelLabel(s: { level: LevelId; gen?: { seed: number; size: MapSize } }): string {
  if (s.level === 'procedural' && s.gen) return `Procedural · ${SIZE_INFO[s.gen.size].name}`;
  return MAP_NICE[s.level];
}
