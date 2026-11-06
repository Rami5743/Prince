import type { Server } from 'node:http';
export function serve(port?: number, root?: string): Promise<Server>;
