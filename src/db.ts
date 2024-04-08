import { env } from "bun";
import { Database } from "bun:sqlite";

export function tasksDb() {
	return new Database(env.PATH_SQLITE);
}

export function stmtSubscriberTasksInQueue() {
	return tasksDb().prepare<{ tasksInQueue: "Ok" }, string>("SELECT 'Ok' AS tasksInQueue FROM subscriber WHERE subscriberId = ? AND tasksInQueue < tasksInQueueLimit;");
}

export function stmtSubscriberRegistered() {
	return tasksDb().prepare<{ isRegistered: 0 | 1 }, string>("SELECT EXISTS (SELECT 1 FROM subscriber WHERE subscriberName = ?) AS isRegistered;");
}

export function stmtSubscriberKey() {
	return tasksDb().prepare<Pick<SubscriberTable, "key">, string>("SELECT key FROM subscriber WHERE subscriberId = ?;");
}