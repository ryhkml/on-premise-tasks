import { $, env, file, sleep } from "bun";
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { backupDb } from "./backup";

import { isBefore } from "date-fns";
import { Storage } from "@google-cloud/storage";

describe("Test BACKUP", () => {
	describe("SQLite backup method", () => {
		it("should the env \"BACKUP_METHOD_SQLITE\" to be defined", () => {
			expect(env.BACKUP_METHOD_SQLITE).toBeDefined();
			expect(env.BACKUP_METHOD_SQLITE).toMatch(/(LOCAL|GOOGLE_CLOUD_STORAGE)/i);
		});
	});

	if (env.BACKUP_METHOD_SQLITE == "LOCAL") {
		describe("Local method", () => {
			beforeAll(async () => {
				await backupDb("LOCAL");
				await sleep(1);
			});

			it("should successfully backup the database file to another directory", async () => {
				const isExistsBakDb = await file(env.BACKUP_DIR_SQLITE! + "/bak.tasks.db").exists();
				expect(isExistsBakDb).toBe(true);
			});
		});
	}

	if (env.BACKUP_METHOD_SQLITE == "GOOGLE_CLOUD_STORAGE") {
		describe("Google Cloud Storage credentials", () => {
			it("should the env \"BACKUP_GCS_PROJECT_ID_SQLITE\" to be defined", () => {
				expect(env.BACKUP_GCS_PROJECT_ID_SQLITE).toBeDefined();
			});
			it("should the env \"BACKUP_GCS_PRIVATE_KEY_SQLITE\" to be defined", () => {
				expect(env.BACKUP_GCS_PRIVATE_KEY_SQLITE).toBeDefined();
			});
			it("should the env \"BACKUP_GCS_CLIENT_ID_SQLITE\" to be defined", () => {
				expect(env.BACKUP_GCS_CLIENT_ID_SQLITE).toBeDefined();
			});
			it("should the env \"BACKUP_GCS_CLIENT_EMAIL_SQLITE\" to be defined", () => {
				expect(env.BACKUP_GCS_CLIENT_EMAIL_SQLITE).toBeDefined();
			});
		});
		describe("Google Cloud Storage method", () => {
			const storage = new Storage({
				projectId: env.BACKUP_GCS_PROJECT_ID_SQLITE,
				credentials: {
					private_key: env.BACKUP_GCS_PRIVATE_KEY_SQLITE,
					client_id: env.BACKUP_GCS_CLIENT_ID_SQLITE,
					client_email: env.BACKUP_GCS_CLIENT_EMAIL_SQLITE,
					type: "service_account"
				},
				timeout: 30000
			});
			const bucket = storage.bucket(env.BACKUP_BUCKET_NAME_SQLITE!);

			beforeAll(async () => {
				await backupDb("GOOGLE_CLOUD_STORAGE");
				await sleep(1);
			});
			afterAll(async () => {
				const [filesBak] = await bucket.getFiles({
					matchGlob: "**/*.db*"
				});
				for (let i = 0; i < filesBak.length; i++) {
					const { name } = filesBak[i];
					await bucket.file(name).delete();
				}
				await sleep(1);
			});

			it("should successfully backup the database file to Google Cloud Storage", async () => {
				const [metadata] = await bucket
					.file(env.BACKUP_BUCKET_DIR_SQLITE + "/bak.tasks.db")
					.getMetadata();
				const isBackupBefore = isBefore(new Date(metadata.updated!), Date.now());
				expect(metadata.contentType).toBe("application/vnd.sqlite3; charset=binary");
				expect(isBackupBefore).toBe(true);
				expect(metadata.name).toBe(env.BACKUP_BUCKET_DIR_SQLITE + "/bak.tasks.db");
			});
		});
	}

	describe("Restore mechanism", () => {
		if (env.BACKUP_METHOD_SQLITE == "GOOGLE_CLOUD_STORAGE") {
			beforeAll(async () => {
				await backupDb("LOCAL");
				await sleep(1);
			});
		}
		afterAll(async () => {
			await $`rm -rf ${env.BACKUP_DIR_SQLITE}`;
			await sleep(1);
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
});