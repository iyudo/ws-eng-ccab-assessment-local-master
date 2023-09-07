import express from "express";
import { createClient } from "redis";
import { json } from "body-parser";

const DEFAULT_BALANCE = 100;
const CHARGE_WITH_AMOUNT_SCRIPT = 'if tonumber(redis.call("get",KEYS[1])) >= tonumber(ARGV[1]) then redis.call("decrby", KEYS[1] , tonumber(ARGV[1])) redis.call("set", KEYS[2], 1) else redis.call("set", KEYS[2], -1) end return redis.call("mget", KEYS[1], KEYS[2])';
let CHARGE_WITH_AMOUNT_EVAL_SHA: string;

interface ChargeResult {
    isAuthorized: boolean;
    remainingBalance: number;
    charges: number;
}

export async function connect(): Promise<ReturnType<typeof createClient>> {
    const url = `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`;
    console.log(`Using redis URL ${url}`);
    const client = createClient({ url });
    await client.connect();
    CHARGE_WITH_AMOUNT_EVAL_SHA = await client.scriptLoad(CHARGE_WITH_AMOUNT_SCRIPT);
    return client;
}

async function reset(account: string): Promise<void> {
    const client = await connect();
    try {
        await client.set(`${account}/balance`, DEFAULT_BALANCE);
    } finally {
        await client.disconnect();
    }
}

async function charge(account: string, charges: number): Promise<ChargeResult> {
    const client = await connect();
    try {
        if (charges < 0) {
            throw new Error("Charges must be positive");
        }
        const results = await client.evalSha(CHARGE_WITH_AMOUNT_EVAL_SHA, {
            keys: [`${account}/balance`, `${account}/operationStatus`],
            arguments: [charges.toString()]
        }) as string[];
        let remainingBalance = Number(results[0]);
        let operationStatus = Number(results[1]);
        if (operationStatus > 0) {
            return { isAuthorized: true, remainingBalance: remainingBalance, charges: charges };
        } else if (operationStatus < 0) {
            return { isAuthorized: false, remainingBalance: remainingBalance, charges: 0 };
        } else {
            throw new Error("Something went wrong");
        }
    } finally {
        await client.disconnect();
    }
}

export function buildApp(): express.Application {
    const app = express();
    app.use(json());
    app.post("/reset", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            await reset(account);
            console.log(`Successfully reset account ${account}`);
            res.sendStatus(204);
        } catch (e) {
            console.error("Error while resetting account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    app.post("/charge", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            const result = await charge(account, req.body.charges ?? 10);
            console.log(`Successfully charged account ${account}`);
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    return app;
}
