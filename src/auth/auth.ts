import { env, password } from "bun";
import { Database } from "bun:sqlite";

import { Context } from "elysia";

import { SubscriberContext } from "../apis/subscriber";

export const isValidSubscriber = async (ctx: Context) => {
    const reqId = ctx.request.headers.get("x-tasks-subsciber-id");
    const bearer = ctx.request.headers.get("authorization");
    if (reqId == null || bearer == null) {
        ctx.set.status = "Unauthorized";
        return {
            message: ""
        };
    }
    const key = bearer.substring(7, bearer.length);
    const secretKey = getSecretKey(reqId);
    if (secretKey == null) {
        ctx.set.status = "Unauthorized";
        return {
            message: ""
        };
    }
    const isValid = await password.verify(key, secretKey, "argon2id");
    if (!isValid) {
        ctx.set.status = "Unauthorized";
        return {
            message: ""
        };
    }
}

const getSecretKey = (id: string) => {
    try {
        const db = new Database(env.PATH_SQLITE);
        const q = db.query("SELECT secretKey FROM subscriber WHERE id = @id;");
        const value = q.get({ "@id": id }) as Pick<SubscriberContext, "secretKey"> | null;
        q.finalize();
        if (value == null) {
            return null;
        }
        return value.secretKey;
    } catch (e) {
        console.error(e);
        return null;
    }
}