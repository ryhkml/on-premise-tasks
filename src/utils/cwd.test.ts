import { describe, expect, it } from "bun:test";

import { cwd } from "./cwd";

describe("Test CWD", () => {
	it("should return the absolute path \"main.ts\"", () => {
		const path = cwd(".");
		expect(path.indexOf("/")).toBe(0);
		expect(path).toMatch(/main\.ts/);
	});
});