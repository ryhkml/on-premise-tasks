import { argv, env, file, write } from "bun";
import { Database } from "bun:sqlite";

import { firstValueFrom, timer } from "rxjs";

async function initDb() {
    try {
        let path = env.PATH_SQLITE;
        let isDev = env.LEVEL == "DEV";
        if (argv[2]?.trim().toLowerCase() == "test") {
            path = env.PATH_TEST_SQLITE
            isDev = true;
        }
        if (path == null) {
            throw new Error("env PATH_SQLITE is empty");
        }
        const db = new Database(path);
        await write(path, "");
        await firstValueFrom(timer(1000));
        db.exec("PRAGMA journal_mode = WAL;");
        db.exec("PRAGMA foreign_keys = ON;");
        const createSubscriberTable = await file("./src/sql/tables/subscriber.sql").text();
        db.run(createSubscriberTable);
        if (isDev) {
            console.log("Table test subscriber created");
        } else {
            console.log("Table subscriber created");
        }
        const createQueueTable = await file("./src/sql/tables/queue.sql").text();
        db.run(createQueueTable);
        if (isDev) {
            console.log("Table test queue created");
            console.log("Sqlite test file in", path);
        } else {
            console.log("Table queue created");
            console.log("Sqlite file in", path);
        }
    } catch (e) {
        console.error(e);
    }
}

initDb();