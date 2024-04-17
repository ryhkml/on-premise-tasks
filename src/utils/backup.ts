import { env, file, write } from "bun";

export async function backupDb(method = env.BACKUP_METHOD_SQLITE!) {
	if (method == "LOCAL") {
		try {
			const isExistsDb = await file(env.PATH_SQLITE!).exists();
			const isExistsDbShm = await file(env.PATH_SQLITE! + "-shm").exists();
			const isExistsDbWal = await file(env.PATH_SQLITE! + "-wal").exists();
			if (isExistsDb) {
				const db = file(env.PATH_SQLITE!);
				await write(env.BACKUP_DIR_SQLITE! + "/bak.tasks.db", db);
			}
			if (isExistsDbShm) {
				const dbShm = file(env.PATH_SQLITE! + "-shm");
				await write(env.BACKUP_DIR_SQLITE! + "/bak.tasks.db-shm", dbShm);
			}
			if (isExistsDbWal) {
				const dbWal = file(env.PATH_SQLITE! + "-wal");
				await write(env.BACKUP_DIR_SQLITE! + "/bak.tasks.db-wal", dbWal);
			}
		} catch (e) {
			console.error("Backup DB", String(e));
		}
	}
}