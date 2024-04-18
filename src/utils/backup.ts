import { env, file, write } from "bun";

import { Storage } from "@google-cloud/storage";

export async function backupDb(method: SqliteBackupMethod) {
	if (method == "LOCAL") {
		try {
			const db = file(env.PATH_SQLITE!);
			const isExistsDb = await db.exists();
			const dbShm = file(env.PATH_SQLITE! + "-shm");
			const isExistsDbShm = await dbShm.exists();
			const dbWal = file(env.PATH_SQLITE! + "-wal");
			const isExistsDbWal = await dbWal.exists();
			if (isExistsDb) {
				await write(env.BACKUP_DIR_SQLITE! + "/bak.tasks.db", db);
			}
			if (isExistsDbShm) {
				await write(env.BACKUP_DIR_SQLITE! + "/bak.tasks.db-shm", dbShm);
			}
			if (isExistsDbWal) {
				await write(env.BACKUP_DIR_SQLITE! + "/bak.tasks.db-wal", dbWal);
			}
		} catch (e) {
			console.error("Backup DB", String(e));
		}
	}
	if (method == "GOOGLE_CLOUD_STORAGE") {
		try {
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
			// Db
			const isExistsDb = await file(env.PATH_SQLITE!).exists();
			if (isExistsDb) {
				await bucket.upload(env.PATH_SQLITE!, {
					destination: env.BACKUP_BUCKET_DIR_SQLITE + "/bak.tasks.db",
					metadata: {
						contentType: "application/vnd.sqlite3; charset=binary"
					}
				});
			}
			// Db shm
			const isExistsDbShm = await file(env.PATH_SQLITE! + "-shm").exists();
			if (isExistsDbShm) {
				await bucket.upload(env.PATH_SQLITE! + "-shm", {
					destination: env.BACKUP_BUCKET_DIR_SQLITE + "/bak.tasks.db-shm",
					metadata: {
						contentType: "application/octet-stream; charset=binary"
					}
				});
			}
			// Db wal
			const isExistsDbWal = await file(env.PATH_SQLITE! + "-wal").exists();
			if (isExistsDbWal) {
				await bucket.upload(env.PATH_SQLITE! + "-wal", {
					destination: env.BACKUP_BUCKET_DIR_SQLITE + "/bak.tasks.db-wal",
					metadata: {
						contentType: "application/octet-stream; charset=binary"
					}
				});
			}
		} catch (err) {
			console.error(String(err));
		}
	}
}