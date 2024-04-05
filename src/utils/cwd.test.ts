import { describe, expect, it } from "bun:test";

import { cwd } from "./cwd";

describe("Test CWD", () => {
	it("should return the full path of the project directory", () => {
		const dir = cwd("");
		expect(dir.indexOf("/")).toBe(0);
	});
});