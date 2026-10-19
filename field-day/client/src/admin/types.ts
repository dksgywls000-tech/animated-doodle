export interface Category { key: string; label: string; kind: 'main' | 'event' | 'cheer'; subtypes: { key: string; label: string }[] }
export interface TeamScore { teamNumber: number; name: string; total: number; activeAwards: number; rank: number }
export interface LogEntry {
  id: string; teamNumber: number; categoryKey: string; categoryLabel: string; subtypeKey: string | null; subtypeLabel: string | null;
  points: number; reason: string; actorId: string; actorName: string; createdAt: string; status: 'active' | 'cancelled';
  reversal: { id: string; points: number; reason: string; actorId: string; actorName: string; createdAt: string } | null;
}
