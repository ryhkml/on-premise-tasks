import { env } from "bun";
import { Database } from "bun:sqlite";

import { cwd, exit } from "node:process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function tasksDb() {
	if (env.PATH_SQLITE == null) {
		console.error("Database path is empty");
		exit(1);
	}
	const path = join(cwd(), env.PATH_SQLITE);
	if (!existsSync(path)) {
		console.error("Database file not found");
		exit(1);
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