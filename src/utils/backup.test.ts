import { $, env, file, write } from "bun";
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { basename } from "node:path";

import { backupDb } from "./backup";

import { Storage } from "@google-cloud/storage";
import { isBefore } from "date-fns";

describe("Test BACKUP", () => {
	describe("SQLite backup method", () => {
		it("should the env variables to be defined", () => {
			expect(env.PATH_SQLITE).toBeDefined();
			expect(env.BACKUP_DIR_SQLITE).toBeDefined();
			expect(env.BACKUP_METHOD_SQLITE).toBeDefined();
			expect(env.BACKUP_METHOD_SQLITE).toMatch(/(LOCAL|GOOGLE_CLOUD_STORAGE)/i);
			if (env.BACKUP_METHOD_SQLITE == "GOOGLE_CLOUD_STORAGE") {
				expect(env.BACKUP_GCS_PROJECT_ID_SQLITE).toBeDefined();
				expect(env.BACKUP_GCS_PRIVATE_KEY_SQLITE).toBeDefined();
				expect(env.BACKUP_GCS_CLIENT_ID_SQLITE).toBeDefined();
				expect(env.BACKUP_GCS_CLIENT_EMAIL_SQLITE).toBeDefined();
				expect(env.BACKUP_BUCKET_NAME_SQLITE).toBeDefined();
				expect(env.BACKUP_BUCKET_DIR_SQLITE).toBeDefined();
			}
		});
	});

	if (env.BACKUP_METHOD_SQLITE == "LOCAL") {
		describe("Local method", () => {
			let tar: { [k: string]: string };

			beforeAll(async () => {
				tar = await backupDb("LOCAL");
			});
			afterAll(async () => {
				await $`rm -rf ${env.BACKUP_DIR_SQLITE}`;
			});

			it("should successfully backup the database file to another directory", async () => {
				const isExistsBakDb = await file(env.BACKUP_DIR_SQLITE + tar.output.substring(1)).exists();
				expect(isExistsBakDb).toBe(true);
			});
			it("should successfully restore the database file from another directory", async () => {
				let pathSqlite = "";
				if (tar.method == "lib") {
					await $`tar -xzf ${tar.output} --strip-components=1`.cwd(env.BACKUP_DIR_SQLITE!);
					pathSqlite = env.BACKUP_DIR_SQLITE + "/" + basename(env.PATH_SQLITE!);
				} else {
					await $`tar -xzf ${tar.output}`.cwd(env.BACKUP_DIR_SQLITE!);
					if (env.PATH_SQLITE!.startsWith(".")) {
						pathSqlite = env.BACKUP_DIR_SQLITE + env.PATH_SQLITE!.substring(1);
					} else {
						pathSqlite = env.BACKUP_DIR_SQLITE + env.PATH_SQLITE!;
					}
				}
				const db = new Database(pathSqlite);
				expect(db.filename).toBe(pathSqlite);
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
	}

	if (env.BACKUP_METHOD_SQLITE == "GOOGLE_CLOUD_STORAGE") {
		describe("Google Cloud Storage method", () => {
			let tar: { [k: string]: string };
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
				tar = await backupDb("GOOGLE_CLOUD_STORAGE");
			});
			afterAll(async () => {
				await Promise.all([
					bucket.file(env.BACKUP_BUCKET_DIR_SQLITE + tar.output.substring(1)).delete(),
					$`rm -rf ${env.BACKUP_DIR_SQLITE}`
				]);
			});

			it("should successfully backup the database file to Google Cloud Storage", async () => {
				const [exists] = await bucket.file(env.BACKUP_BUCKET_DIR_SQLITE + tar.output.substring(1)).exists();
				expect(exists).toBe(true);
			});
			it("should successfully restore the database file from Google Cloud Storage", async () => {
				const pathTarDownload = env.BACKUP_DIR_SQLITE! + tar.output.substring(1);
				const [buffer] = await bucket.file(env.BACKUP_BUCKET_DIR_SQLITE + tar.output.substring(1)).download();
				await write(pathTarDownload, buffer);
				let pathSqlite = "";
				if (tar.method == "lib") {
					await $`tar -xzf ${tar.output} --strip-components=1`.cwd(env.BACKUP_DIR_SQLITE!);
					pathSqlite = env.BACKUP_DIR_SQLITE + "/" + basename(env.PATH_SQLITE!);
				} else {
					await $`tar -xzf ${tar.output}`.cwd(env.BACKUP_DIR_SQLITE!);
					if (env.PATH_SQLITE!.startsWith(".")) {
						pathSqlite = env.BACKUP_DIR_SQLITE + env.PATH_SQLITE!.substring(1);
					} else {
						pathSqlite = env.BACKUP_DIR_SQLITE + env.PATH_SQLITE!;
					}
				}
				const db = new Database(pathSqlite);
				expect(db.filename).toBe(pathSqlite);
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
	}
});