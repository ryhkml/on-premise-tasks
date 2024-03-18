import { Elysia } from "elysia";
import { toString } from "lodash";

import { tasksDb } from "./db";

export function pluginApi() {
    return new Elysia({ name: "pluginApi" })
        .decorate("db", tasksDb())
        .derive({ as: "global" }, ctx => {
            const auth = ctx.headers["authorization"];
            return {
                id: toString(ctx.headers["x-tasks-subscriber-id"]).trim(),
                key: auth?.startsWith("Bearer ")
                    ? auth.slice(7)
                    : "",
                today: Date.now()
            };
        })
        .headers({
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Expires": "0",
            "X-XSS-Protection": "0"
        });
}