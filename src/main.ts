import { env } from "bun";
import { Database } from "bun:sqlite";

import { Elysia } from "elysia";

import { subscriber } from "./apis/subscriber";

const port = +env.PORT! || 3200;
const app = new Elysia()
    .onError(ctx => {
        if (ctx.code == "NOT_FOUND") {
            ctx.set.status = "Not Found";
            return null;
        }
        const message = JSON.parse(ctx.error.message)["message"] as string;
        return {
            message
        }
    })
    .use(subscriber)
    .listen(port);

try {
    const db = new Database(env.PATH_SQLITE);
    db.exec("PRAGMA journal_mode = WAL;");
    console.log("Database OK");
} catch (e) {
    console.error(e);
}

console.log("Server listening on port", app.server?.port);