import { password } from "bun";
import { Database } from "bun:sqlite";

import { Context } from "elysia";

interface AuthContext extends Context {
    db: Database;
    id: string;
    key: string;
    today: number;
}

export async function isValidSubscriber(ctx: AuthContext) {
    if (ctx.id == "" || ctx.key == "") {
        return ctx.error("Unauthorized", {
            message: "The request did not include valid authentication"
        });
    }
    const hashKey = getKey(ctx.db, ctx.id);
    if (hashKey == null) {
        return ctx.error("Unauthorized", {
            message: "The request did not include valid authentication"
        });
    }
    const isValid = await password.verify(ctx.key, hashKey, "argon2id");
    if (!isValid) {
        return ctx.error("Forbidden", {
            message: "The server did not accept valid authentication"
        });
    }
}

function getKey(db: Database, id: string) {
    const q = db.query("SELECT key FROM subscriber WHERE subscriberId = ?;");
    const value = q.get(id) as Pick<SubscriberContext, "key"> | null;
    if (value == null) {
        return null;
    }
    return value.key;
}