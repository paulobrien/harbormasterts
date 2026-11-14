/** Local single-player records for the Treasure Island port. */
export interface ShiftStats { shifts: number; totalCargo: number; best: number }
interface StoredStats extends ShiftStats { completedShiftIds: string[] }
const STATS_KEY = 'harbor-treasure-island-stats-v1';
const empty = (): StoredStats => ({ shifts: 0, totalCargo: 0, best: 0, completedShiftIds: [] });
function readStoredStats(storage: Pick<Storage, 'getItem'>): StoredStats {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STATS_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty();
    const p = parsed as Record<string, unknown>;
    if (![p.shifts, p.totalCargo, p.best].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return empty();
    // Old records predate shift IDs; keep all their totals during migration.
    const completedShiftIds = Array.isArray(p.completedShiftIds)
      ? p.completedShiftIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128)
      : [];
    return { shifts: p.shifts as number, totalCargo: p.totalCargo as number, best: p.best as number, completedShiftIds };
  } catch { return empty(); }
}
const visibleStats = (stats: ShiftStats): ShiftStats => ({ shifts: stats.shifts, totalCargo: stats.totalCargo, best: stats.best });
export function readShiftStats(storage: Pick<Storage, 'getItem'> = localStorage): ShiftStats {
  return visibleStats(readStoredStats(storage));
}
/** Duplicate callbacks and restored copies of a recorded shift cannot double-count. */
export class ShiftRecorder {
  private recorded = false;
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage, private readonly shiftId?: string) {}
  complete(score: number): ShiftStats {
    const previous = readStoredStats(this.storage);
    const id = typeof this.shiftId === 'string' && this.shiftId.length > 0 && this.shiftId.length <= 128 ? this.shiftId : undefined;
    if (this.recorded || (id && previous.completedShiftIds.includes(id))) return visibleStats(previous);
    this.recorded = true;
    const cargo = Math.max(0, Math.floor(Number.isFinite(score) ? score : 0));
    const updated: StoredStats = { shifts: previous.shifts + 1, totalCargo: previous.totalCargo + cargo, best: Math.max(previous.best, cargo), completedShiftIds: id ? [...previous.completedShiftIds, id] : previous.completedShiftIds };
    try { this.storage.setItem(STATS_KEY, JSON.stringify(updated)); } catch { /* If storage is unavailable, keep the result in the current UI. */ }
    return visibleStats(updated);
  }
}
