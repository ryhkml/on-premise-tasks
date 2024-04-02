import { Elysia } from "elysia";
import { toSafeInteger } from "lodash";

export function pluginContentLength(maxSize: number = 65536) {
	return new Elysia({ name: "pluginContentLength", seed: maxSize })
		.onBeforeHandle({ as: "scoped" }, ctx => {
			const len = toSafeInteger(ctx.request.headers.get("content-length"));
			if (len > maxSize) {
				return ctx.error("Payload Too Large", {
					message: "The request is larger than the server is willing or able to process"
				});
			}
		});
}