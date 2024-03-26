import { describe, expect, it } from "bun:test";

import { decr, encr } from "./crypto";

describe("Test CRYPTO", () => {
	it("should encrypt the message", () => {
		const key = Date.now().toString();
		const message = "Hello world";
		const chiper = encr(message, key);
		expect(chiper).toMatch(/^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/);
	});
	it("should decrypt the message", () => {
		const key = Date.now().toString();
		const chiper = encr("Hello world", key);
		const message = decr(chiper, key);
		expect(message).toBe("Hello world");
	});
});