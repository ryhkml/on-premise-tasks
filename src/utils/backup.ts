import { Glob, env, file, write } from "bun";

import { createReadStream } from "node:fs";
import { basename } from "node:path";

import { Storage } from "@google-cloud/storage";

export async function backupDb(method: SqliteBackupMethod) {
	if (method == "LOCAL") {
		try {
			const db = file(env.PATH_SQLITE!);
			const dbShm = file(env.PATH_SQLITE! + "-shm");
			const dbWal = file(env.PATH_SQLITE! + "-wal");
			const [isExistsDb, isExistsDbShm, isExistsDbWal] = await Promise.all([
				db.exists(),
				dbShm.exists(),
				dbWal.exists()
			]);
			if (isExistsDb) {
				await write(env.BACKUP_DIR_SQLITE! + "/bak." + basename(env.PATH_SQLITE!), db);
			}
			if (isExistsDbShm) {
				await write(env.BACKUP_DIR_SQLITE! + "/bak." + basename(env.PATH_SQLITE!) + "-shm", dbShm);
			}
			if (isExistsDbWal) {
				await write(env.BACKUP_DIR_SQLITE! + "/bak." + basename(env.PATH_SQLITE!) + "-wal", dbWal);
			}
		} catch (e) {
			console.error("Backup DB", String(e));
		}
	}
	if (method == "GOOGLE_CLOUD_STORAGE") {
		try {
			const paths = [] as Array<string>;
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
			const [isExistsDb, isExistsDbShm, isExistsDbWal] = await Promise.all([
				file(env.PATH_SQLITE!).exists(),
				file(env.PATH_SQLITE! + "-shm").exists(),
				file(env.PATH_SQLITE! + "-wal").exists()
			]);
			if (isExistsDb) {
				paths.push(env.PATH_SQLITE!);
			}
			if (isExistsDbShm) {
				paths.push(env.PATH_SQLITE! + "-shm");
			}
			if (isExistsDbWal) {
				paths.push(env.PATH_SQLITE! + "-wal");
			}
			for (let i = 0; i < paths.length; i++) {
				const path = paths[i];
				const globDb = new Glob("*.db");
				const filename = "bak." + basename(path);
				const writable = storage.bucket(env.BACKUP_BUCKET_NAME_SQLITE!).file(env.BACKUP_BUCKET_DIR_SQLITE + "/" + filename).createWriteStream({
					metadata: {
						contentType: globDb.match(filename)
							? "application/vnd.sqlite3; charset=binary"
							: "application/octet-stream; charset=binary"
					}
				});
				const readable = createReadStream(path);
				readable.pipe(writable);
				await new Promise((resolve, reject) => {
					writable.on("finish", resolve);
					writable.on("error", reject);
				});
			}
		} catch (e) {
			console.error("Backup DB", String(e));
		}
	}
}