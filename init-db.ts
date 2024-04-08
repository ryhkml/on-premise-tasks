import { $, env, file, sleep, write } from "bun";
import { Database } from "bun:sqlite";

async function initDb() {
	try {
		const delay = 2000;
		const initAt = Date.now();
		if (env.PATH_SQLITE == null) {
			throw new Error("Path sqlite is empty");
		}
		const isDbExists = await file(env.PATH_SQLITE).exists();
		if (isDbExists) {
			$`rm -rf ${env.PATH_SQLITE}*`.then(() => {});
			await sleep(delay);
		}
		await write(env.PATH_SQLITE, "");
		await sleep(delay / 2);
		const db = new Database(env.PATH_SQLITE);
		db.run("PRAGMA journal_mode = WAL;");
		db.run("PRAGMA synchronous = NORMAL;");
		db.run("PRAGMA foreign_keys = ON;");
		db.run("PRAGMA journal_size_limit = 1048576;");
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
	} catch (e) {
		throw e;
	}
}

initDb()
	.then(() => console.log("\x1b[32mThe table was created successfully\x1b[0m"))
	.catch(e => console.error(e));