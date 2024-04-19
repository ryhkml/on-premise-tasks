import { $, env, file, sleep, write } from "bun";
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { basename } from "node:path";

import { backupDb } from "./backup";

import { DownloadResponse, Storage, TransferManager } from "@google-cloud/storage";
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
			beforeAll(async () => {
				await backupDb("LOCAL");
				await sleep(1);
			});
			afterAll(async () => {
				await $`rm -rf ${env.BACKUP_DIR_SQLITE}`;
				await sleep(1);
			});

			it("should successfully backup the database file to another directory", async () => {
				const isExistsBakDb = await file(env.BACKUP_DIR_SQLITE! + "/bak." + basename(env.PATH_SQLITE!)).exists();
				expect(isExistsBakDb).toBe(true);
			});
			it("should successfully restore the database file from another directory", () => {
				const path = env.BACKUP_DIR_SQLITE + "/bak." + basename(env.PATH_SQLITE!);
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
	}

	if (env.BACKUP_METHOD_SQLITE == "GOOGLE_CLOUD_STORAGE") {
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
				await $`rm -rf ${env.BACKUP_DIR_SQLITE}`;
				await sleep(1);
			});

			it("should successfully backup the database file to Google Cloud Storage", async () => {
				const [exists] = await bucket
					.file(env.BACKUP_BUCKET_DIR_SQLITE + "/bak." + basename(env.PATH_SQLITE!))
					.exists();
				expect(exists).toBe(true);
			});
			it("should successfully restore the database file from Google Cloud Storage", async () => {
				const paths = [] as Array<string>;
				const [isBakDbExists, isBakDbShmExists, isBakDbWalExists] = await Promise.all([
					bucket.file(env.BACKUP_BUCKET_DIR_SQLITE + "/bak." + basename(env.PATH_SQLITE!)).exists(),
					bucket.file(env.BACKUP_BUCKET_DIR_SQLITE + "/bak." + basename(env.PATH_SQLITE!) + "-shm").exists(),
					bucket.file(env.BACKUP_BUCKET_DIR_SQLITE + "/bak." + + basename(env.PATH_SQLITE!) + "-wal").exists()
				]);
				if (isBakDbExists) {
					paths.push(env.BACKUP_BUCKET_DIR_SQLITE + "/bak." + basename(env.PATH_SQLITE!));
				}
				if (isBakDbShmExists) {
					paths.push(env.BACKUP_BUCKET_DIR_SQLITE + "/bak." + basename(env.PATH_SQLITE!) + "-shm");
				}
				if (isBakDbWalExists) {
					paths.push(env.BACKUP_BUCKET_DIR_SQLITE + "/bak." + basename(env.PATH_SQLITE!) + "-wal");
				}
				const tfm = new TransferManager(bucket);
				const res = await tfm.downloadManyFiles(paths) as unknown as Array<DownloadResponse>;
				for (let i = 0; i < res.length; i++) {
					const item = res[i];
					const buffer = item[0];
					await write(env.BACKUP_DIR_SQLITE + "/" + basename(paths[i]), buffer);
				}
				await sleep(1);
				const path = env.BACKUP_DIR_SQLITE + "/bak." + basename(env.PATH_SQLITE!);
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
	}
});