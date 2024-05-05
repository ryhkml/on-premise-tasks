import { $, env, file, write } from "bun";
import { FFIType, dlopen, suffix } from "bun:ffi";

import { dirname } from "node:path";
import { unlinkSync } from "node:fs";

import { Storage } from "@google-cloud/storage";

export async function backupDb(method: SqliteBackupMethod = "LOCAL") {
	const tar = await tarDb();
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
		await storage.bucket(env.BACKUP_BUCKET_NAME_SQLITE!).upload(tar.output, {
			destination: env.BACKUP_BUCKET_DIR_SQLITE + tar.output.substring(1),
			metadata: {
				contentType: "application/tar+gzip"
			}
		});
		unlinkSync(tar.output);
		return tar;
	}
	await write(env.BACKUP_DIR_SQLITE! + tar.output.substring(1), file(tar.output));
	unlinkSync(tar.output);
	return tar;
}

async function tarDb() {
	const output = "./db-" + new Date().toISOString() + ".bak.tar.gz";
	try {
		await $`tar -czf ${output} ${dirname(env.PATH_SQLITE!)}`;
		return {
			output,
			method: "default"
		};
	} catch (_) {
		// If "tar" command is not available
		// Or use distroless docker image
		const lib = dlopen("/usr/local/lib/libtar." + suffix, {
			compress_dir: {
				args: [
					FFIType.pointer,
					FFIType.pointer
				],
				returns: FFIType.u8
			}
		});
		const isDone = !!lib.symbols.compress_dir(
			Buffer.from("./db" + "\0", "utf-8"),
			Buffer.from(output + "\0", "utf-8")
		);
		if (isDone) {
			return {
				output,
				method: "lib"
			}
		}
		throw new Error("Compression failed");
	}
}