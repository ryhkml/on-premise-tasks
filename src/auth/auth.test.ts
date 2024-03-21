import { env, password } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { treaty } from "@elysiajs/eden";

import { subscriber } from "../apis/subscriber";

const port = +env.PORT! || 3200;
const app = subscriber().listen(port);
const api = treaty(app);
const db = app.decorator.db;

describe("TEST AUTH", () => {
	const name = "test-auth";
	beforeAll(() => {
		db.exec("PRAGMA journal_mode = WAL;");
	});
	afterAll(() => {
		db.run("DELETE FROM subscriber WHERE subscriberName = ?;", [name]);
	});
	describe("select secret key", () => {
		it("should respond argon2id hash algorithm", async () => {
			const { data, status } = await api.subscribers.register.post({ name });
			const q = db.query("SELECT key FROM subscriber WHERE subscriberId = ?;");
			const secret = q.get(data?.id!) as { key: string } | null;
			expect(status).toBe(201);
			expect(secret?.key).toMatch(/\$argon2id\$/);
			const isValid = await password.verify(data?.key!, secret?.key!, "argon2id");
			expect(isValid).toBe(true);
		});
	});
});