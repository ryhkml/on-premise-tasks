import { env } from "bun";

import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { toString } from "lodash";

import { subscriber } from "./apis/subscriber";
import { subscription } from "./apis/subscription";

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
    .onError(ctx => {
        if (ctx.code == "VALIDATION") {
            ctx.set.status = "Bad Request";
            return {
                message: JSON.parse(ctx.error.message)["message"]
            };
        }
        if (ctx.code == "NOT_FOUND") {
            return {
                message: "The request did not match any resource. Visit /swagger for more information"
            };
        }
        console.error("ERROR HTTP EXCEPTION:", ctx.error.message);
        return ctx.error;
    })
    .use(subscriber())
    .use(subscription())
    .onStart(ctx => {
        try {
            ctx.decorator.db.exec("PRAGMA journal_mode = WAL;");
            ctx.decorator.db.exec("PRAGMA foreign_keys = ON;");
            console.log("Database ok");
        } catch (e) {
            console.error("ERROR DATABASE:", toString(e));
        }
    })
    .listen(port);

console.log("Server listening on port", app.server?.port);