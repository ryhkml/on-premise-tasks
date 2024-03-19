import { env } from "bun";
import { Database } from "bun:sqlite";

import { existsSync } from "node:fs";

export function tasksDb() {
    let path = env.PATH_SQLITE;
    if (env.LEVEL == "DEV") {
        path = env.PATH_TEST_SQLITE;
    }
    if (path == null) {
        throw new Error("env PATH_SQLITE is empty");
    }
    if (!existsSync(path)) {
        throw new Error("Database file not found");
    }
    return new Database(path);
}