import { env } from "bun";
import { Database } from "bun:sqlite";

import { existsSync } from "node:fs";

export function tasksDb() {
    if (env.PATH_SQLITE == null) {
        throw new Error("env PATH_SQLITE is empty");
    }
    if (!existsSync(env.PATH_SQLITE)) {
        throw new Error("Database file not found");
    }
    return new Database(env.PATH_SQLITE);
}