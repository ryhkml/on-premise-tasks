import { env, file, write } from "bun";
import { Database } from "bun:sqlite";

import { cwd } from "node:process";
import { join } from "node:path";

import { firstValueFrom, timer } from "rxjs";

async function initDb() {
	try {
		const initAt = Date.now();
		if (env.PATH_SQLITE == null) {
			throw new Error("Database path is empty");
		}
		const path = join(cwd(), env.PATH_SQLITE);
		const db = new Database(path);
		await write(path, "");
		await firstValueFrom(timer(1000));
		db.exec("PRAGMA journal_mode = WAL;");
		db.exec("PRAGMA synchronous = NORMAL;");
		db.exec("PRAGMA foreign_keys = ON;");
		db.exec("PRAGMA journal_size_limit = 1048576;");
		const [t1, t2, t3, t4] = await Promise.all([
			file("./src/sql/tables/subscriber.sql").text(),
			file("./src/sql/tables/queue.sql").text(),
			file("./src/sql/tables/config.sql").text(),
			file("./src/sql/tables/timeframe.sql").text()
		]);
		db.transaction(() => {
			db.run(t1);
			db.run(t2);
			db.run(t3);
			db.run(t4);
			db.run("INSERT INTO timeframe (lastRecordAt) VALUES (?);", [initAt]);
		})();
		console.log("\x1b[32mThe table was created successfully\x1b[0m");
	} catch (e) {
		console.error(e);
	}
}

initDb();