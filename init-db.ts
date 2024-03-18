import { env, file, write } from "bun";
import { Database } from "bun:sqlite";

import { lastValueFrom, timer } from "rxjs";

async function initDb() {
    try {
        const path = env.PATH_SQLITE;
        if (path == null) {
            throw new Error("env PATH_SQLITE is empty");
        }
        const db = new Database(path);
        await write(path, "");
        await lastValueFrom(timer(1000));
        db.exec("PRAGMA journal_mode = WAL;");
        db.exec("PRAGMA foreign_keys = ON;");
        const createSubscriberTable = await file("./src/sql/tables/subscriber.sql").text();
        db.run(createSubscriberTable);
        console.log("Table subscriber created");
        const createSubscriptionTable = await file("./src/sql/tables/subscription.sql").text();
        db.run(createSubscriptionTable);
        console.log("Table subscription created");
        console.log("Sqlite file in", path);
    } catch (e) {
        console.error(e);
    }
}

initDb();