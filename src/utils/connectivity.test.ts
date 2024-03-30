import { describe, expect, it } from "bun:test";

import { connectivity } from "./connectivity";

describe("Test CONNECTIVITY", () => {
	it("should respond online if the server is connected to the internet", () => {
		connectivity().subscribe({
			next(res) {
				expect(res).toBe("Online");
			}
		})
	});
});