import { performance } from "perf_hooks";
import supertest from "supertest";
import assert from "assert";
import { buildApp, connect } from "./app";

const app = supertest(buildApp());

async function basicLatencyTest() {
    await app.post("/reset").expect(204);
    const start = performance.now();
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    console.log(`Latency: ${performance.now() - start} ms`);
}

async function simultaneousCallTest() {
    await app.post("/reset").expect(204);
    const start = performance.now();
    let requests: supertest.Test[] = [];
    for (let i = 0; i < 10; i++) {
        requests.push(app.post("/charge").send({
            charges: 20
        }));
    }
    const responses = await Promise.all(requests);
    console.log(`Latency: ${performance.now() - start} ms`);

    let gotTotalAuthorizedResponses = 0;
    let expectedTotalAuthorizedResponses = 5;
    responses.forEach(response => {  
        if (response.statusCode == 200 && response.body.isAuthorized) {
            gotTotalAuthorizedResponses++;
        }
    });
    console.log(`Actual total authorized responses: ${gotTotalAuthorizedResponses}, expected total authorized responses: ${expectedTotalAuthorizedResponses}`);
    assert.strictEqual(expectedTotalAuthorizedResponses, gotTotalAuthorizedResponses);
    
    const client = await connect();
    try {
        const expectedRemainingBalance = 0;
        const actualRemainingBalance = parseInt((await client.get("account/balance")) ?? "");
        console.log(`Actual remaining balance: ${actualRemainingBalance}, expected remaining balance: ${expectedRemainingBalance}`)
        assert.strictEqual(expectedRemainingBalance, actualRemainingBalance);
    } finally {
        await client.disconnect();
    }
}

async function runTests() {
    await basicLatencyTest();
    await simultaneousCallTest();
}

runTests().catch(console.error);
