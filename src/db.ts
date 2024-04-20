import { env } from "bun";
import { Database } from "bun:sqlite";

export function tasksDb() {
	return new Database(env.PATH_SQLITE);
}

export function stmtSubscriberTasksInQueue() {
	return tasksDb().prepare<{ tasksInQueue: "Ok" }, string>("SELECT 'Ok' AS tasksInQueue FROM subscriber WHERE id = ? AND tasksInQueue < tasksInQueueLimit;");
}

export function stmtSubscriberRegistered() {
	return tasksDb().prepare<{ isRegistered: 0 | 1 }, string>("SELECT EXISTS (SELECT 1 FROM subscriber WHERE name = ?) AS isRegistered;");
}

export function stmtSubscriberKey() {
	return tasksDb().prepare<Pick<SubscriberTable, "key">, string>("SELECT key FROM subscriber WHERE id = ?;");
}

export function setPragma(db: Database) {
	db.run("PRAGMA journal_mode = WAL;");
	db.run("PRAGMA foreign_keys = ON;");
	db.run("PRAGMA synchronous = OFF;");
	db.run("PRAGMA temp_store = MEMORY;");
	db.run("PRAGMA mmap_size = 4294967296;");
	db.run("PRAGMA page_size = 32768;");
}