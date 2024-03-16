import { env } from "bun";
import { Database } from "bun:sqlite";

import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";

import { subscriber } from "./apis/subscriber";

import { HttpException } from "./exception/http-exception";

const port = +env.PORT! || 3200;
const app = new Elysia()
    .headers({
        "Permissions-Policy": "camera=(), microphone=(), interest-cohort=()",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block"
    })
    .use(swagger({
        documentation: {
            info: {
                title: "On-Premise Tasks API",
                version: "1.0.0-beta.1"
            }
        }
    }))
    .error({
        "HTTP_EXCEPTION": HttpException
    })
    .onError(ctx => {
        if (ctx.code == "HTTP_EXCEPTION") {
            return {
                message: ctx.error.message
            };
        }
        if (ctx.code == "VALIDATION") {
            const message = JSON.parse(ctx.error.message)["message"] as string;
            return {
                message
            };
        }
        if (ctx.code == "NOT_FOUND") {
            ctx.set.status = "Not Found";
            return null;
        }
        ctx.set.status = "Internal Server Error";
        return {
            message: "The server returned an error"
        };
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