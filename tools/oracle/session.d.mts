export interface SessionPhase {
  spec: string; x: number; y: number; shift: boolean; keys: string[]; shots: number;
}
export interface Session {
  name: string; level: number; cycles: number; settle: number; phases: SessionPhase[];
}
export function parseSession(text: string, name?: string): Session;
export function shotNames(session: Session): string[];
export function shotPhases(session: Session): number[];
export function toDosboxScript(session: Session): string;
