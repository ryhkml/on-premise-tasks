import { env, file, write } from "bun";
import { FFIType, dlopen, suffix } from "bun:ffi";

import { unlinkSync } from "node:fs";

import { Storage } from "@google-cloud/storage";

export async function backupDb(method: SqliteBackupMethod = "LOCAL") {
	const tarFilename = tarDb();
	if (method == "GOOGLE_CLOUD_STORAGE") {
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
		await storage.bucket(env.BACKUP_BUCKET_NAME_SQLITE!).upload(tarFilename, {
			destination: env.BACKUP_BUCKET_DIR_SQLITE + tarFilename.substring(1),
			metadata: {
				contentType: "application/tar+gzip"
			}
		});
		unlinkSync(tarFilename);
		return tarFilename;
	}
	await write(env.BACKUP_DIR_SQLITE! + tarFilename.substring(1), file(tarFilename));
	unlinkSync(tarFilename);
	return tarFilename;
}

function tarDb() {
	const pathLib = env.NODE_ENV == "production"
		? "/etc/tasks/lib/libtar." + suffix
		: "./target/release/libtar." + suffix;
	const lib = dlopen(file(pathLib), {
		compress_dir: {
			args: [
				FFIType.pointer,
				FFIType.pointer
			],
			returns: FFIType.u8
		}
	});
	const output = "./db-" + new Date().toISOString() + ".bak.tar.gz";
	const isDone = !!lib.symbols.compress_dir(
		Buffer.from("./db" + "\0", "utf-8"),
		Buffer.from(output + "\0", "utf-8")
	);
	if (isDone) {
		return output;
	}
	throw new Error("Compression failed");
}