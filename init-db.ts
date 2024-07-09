import { env, file, sleep, write } from "bun";
import { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";

import { setPragma } from "./src/db";
import { info } from "./src/utils/logger";
import { cwd } from "./src/utils/cwd";

const initAt = Date.now();

if (env.PATH_SQLITE == null) {
	throw new Error("Path sqlite is empty");
}

const isDbExists = await file(env.PATH_SQLITE).exists();

if (isDbExists) {
	await Promise.all([
		unlink(cwd(env.PATH_SQLITE)),
		unlink(cwd(env.PATH_SQLITE + "-shm")),
		unlink(cwd(env.PATH_SQLITE + "-wal"))
	]);
	await sleep(1);
}

await write(env.PATH_SQLITE, "");
await sleep(1);

const db = new Database(env.PATH_SQLITE, {
	readwrite: true,
	strict: true
});
setPragma(db);

const [t1, t2, t3, t4] = await Promise.all([
	file("./src/sql/tables/subscriber.sql").text(),
	file("./src/sql/tables/queue.sql").text(),
	file("./src/sql/tables/config.sql").text(),
	file("./src/sql/tables/timeframe.sql").text()
]);

db.run(t1);
db.run(t2);
db.run(t3);
db.run(t4);
db.run("INSERT INTO timeframe (lastRecordAt) VALUES (?);", [initAt]);

info("Table was created successfully");