import { $, env, file, sleep } from "bun";
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { backupDb } from "./backup";

import { isBefore } from "date-fns";

describe("Test LOCAL BACKUP DATABASE", () => {
	beforeAll(async () => {
		await backupDb();
		await sleep(1);
	});
	afterAll(async () => {
		await $`rm -rf ${env.BACKUP_DIR_SQLITE}`;
		await sleep(1);
	});

	it("should successfully backup the database file", async () => {
		expect(env.BACKUP_DIR_SQLITE).toBeDefined();
		const isExistsDb = await file(env.BACKUP_DIR_SQLITE! + "/bak.tasks.db").exists();
		expect(isExistsDb).toBe(true);
	});
	it("should successfully restore the database file", () => {
		const path = env.BACKUP_DIR_SQLITE + "/bak.tasks.db";
		const db = new Database(path);
		expect(db.filename).toBe(path);
		const q1 = db.query<{ message: "Ok" }, []>("SELECT 'Ok' AS message;");
		const value1 = q1.get();
		expect(value1?.message).toBe("Ok");
		const q2 = db.query<{ id: 1, lastRecordAt: number }, []>("SELECT * FROM timeframe;");
		const value2 = q2.get();
		expect(value2?.id).toBe(1);
		expect(value2?.lastRecordAt).toBeDefined();
		const isBackupBefore = isBefore(value2?.lastRecordAt!, Date.now());
		expect(isBackupBefore).toBe(true);
	});
});