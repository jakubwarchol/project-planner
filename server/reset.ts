import { rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { DB_PATH, closeDatabase, getDatabase } from "./db";
import { seedIfEmpty } from "./seed";

// Reseeding is deliberate and destructive, so it lives behind its own command
// rather than happening on boot. Nothing else in the server deletes data.
const force = process.argv.includes("--force") || process.argv.includes("-f");

if (!force) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `This DELETES ${DB_PATH} and reseeds from src/data/*.json.\nType "reset" to confirm: `,
  );
  rl.close();
  if (answer.trim() !== "reset") {
    console.log("Aborted — nothing was deleted.");
    process.exit(1);
  }
}

// -wal and -shm hold committed data too; leaving them behind would resurrect
// rows into the fresh file.
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${DB_PATH}${suffix}`, { force: true });

const db = getDatabase();
seedIfEmpty(db);
closeDatabase();

console.log(`Reset complete → ${DB_PATH}`);
