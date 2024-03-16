import { env, password } from "bun";
import { Database } from "bun:sqlite";

import { Context } from "elysia";

import { HttpException } from "../exception/http-exception";

interface AuthContext extends Context {
    id: string;
    key: string;
    requestAt: number;
}

export async function isValidSubscriber(ctx: AuthContext) {
    if (ctx.id == "" || ctx.key == "") {
        ctx.set.status = "Unauthorized";
        throw new HttpException("The request did not include valid authentication");
    }
    const hashKey = getKey(ctx.id);
    if (hashKey == null) {
        ctx.set.status = "Unauthorized";
        throw new HttpException("The request did not include valid authentication");
    }
    const isValid = await password.verify(ctx.key, hashKey, "argon2id");
    if (!isValid) {
        ctx.set.status = "Forbidden";
        throw new HttpException("The server did not accept valid authentication");
    }
}

function getKey(id: string) {
    const db = new Database(env.PATH_SQLITE);
    const q = db.query("SELECT key FROM subscriber WHERE subscriberId = ?;");
    const value = q.get(id) as Pick<SubscriberContext, "key"> | null;
    if (value == null) {
        return null;
    }
    return value.key;
}