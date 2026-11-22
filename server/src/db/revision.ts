import { db } from "./client.js";
export function nextRevision(): number {
  const row = db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev' RETURNING value").get() as { value: string };
  return Number(row.value);
}
export function currentRevision(): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'rev'").get() as { value: string } | undefined;
  return Number(row?.value ?? 0);
}
