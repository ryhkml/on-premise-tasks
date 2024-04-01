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

export function stmtSubscriberTasksInQueue() {
	return tasksDb().prepare<{ tasksInQueue: "Ok" }, string>("SELECT 'Ok' AS tasksInQueue FROM subscriber WHERE subscriberId = ? AND tasksInQueue < tasksInQueueLimit LIMIT 1;");
}

export function stmtSubscriberRegistered() {
	return tasksDb().prepare<{ isRegistered: 0 | 1 }, string>("SELECT EXISTS (SELECT 1 FROM subscriber WHERE subscriberName = ?) AS isRegistered;");
}

export function stmtSubscriberKey() {
	return tasksDb().prepare<Pick<SubscriberTable, "key">, string>("SELECT key FROM subscriber WHERE subscriberId = ? LIMIT 1;");
}