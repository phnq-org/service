import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { matchCategory } from "@phnq/log";
import { Anomaly } from "@phnq/message";
import { createContextFactory, type RequestContext, type SessionContext } from "@/Context";
import { type Serializable, Service, ServiceClient } from "..";
import { NATS_MONITOR_URI } from "../config";
import type { Handler } from "../Service";

if (process.env.PHNQ_MESSAGE_LOG_NATS === "1") {
  matchCategory(/.+/);
}

// ========================== TEST INFRASTRUCTURE ==========================

interface TestRequestContext extends RequestContext {
  bubba: string;
  private: string;
  foo: string;
  language: string;
}
interface TestSessionContext extends SessionContext {
  currentFruit: "apple" | "orange" | "pear";
  shared: string;
}

const TestContext = createContextFactory<TestRequestContext, TestSessionContext>();

interface VegApi {
  domain: "veg";
  handlers: {
    getKinds(): Promise<string[]>;
  };
}

const getVegKinds: Handler<VegApi, "getKinds"> = async () => {
  if (TestContext.current.get("bubba") !== "gump") {
    throw new Error("Nope");
  }

  return ["carrot", "celery", "broccoli"];
};

const vegService = new Service<VegApi>("veg", { handlers: { getKinds: getVegKinds } });

interface FruitApi {
  domain: "fruit";
  handlers: {
    getKinds(): Promise<string[]>;
    getKindsIterator(): Promise<AsyncIterableIterator<"apple" | "orange" | "pear">>;
    doErrors(type: "error" | "anomaly" | "none"): Promise<void>;
    getFromContext(key: string): Promise<Serializable | undefined>;
    getVeggies(): Promise<string[]>;
  };
}

const getKinds: Handler<FruitApi, "getKinds"> = async () => ["apple", "orange", "pear"];

const getKindsIterator: Handler<FruitApi, "getKindsIterator"> = async () =>
  (async function* () {
    TestContext.current.setSession("currentFruit", "apple");
    yield "apple";
    TestContext.current.setSession("currentFruit", "orange");
    yield "orange";
    TestContext.current.setSession("currentFruit", "pear");
    yield "pear";
  })();

const doErrors: Handler<FruitApi, "doErrors"> = async (type) => {
  switch (type) {
    case "anomaly":
      throw new Anomaly("the anomaly");

    case "error":
      throw new Error("the error");
  }
};

const getFromContext: Handler<FruitApi, "getFromContext"> = async (key) => {
  TestContext.current.setRequest("private", "only4me");
  TestContext.current.setSession("shared", "4anyone");

  if (getMyData() !== "only4me") {
    throw new Error("Did not get private data");
  }

  return TestContext.current.get(key as keyof TestRequestContext);
};

const getMyData = (): string | undefined => {
  return TestContext.current.get("private");
};

const getVeggies: Handler<FruitApi, "getVeggies"> = async () => {
  TestContext.current.setRequest("bubba", "gump");
  const vegClient = TestContext.current.getClient<VegApi>("veg");
  return await vegClient.getKinds();
};

const fruitService = new Service<FruitApi>("fruit", {
  handlers: { getKinds, getKindsIterator, doErrors, getFromContext, getVeggies },
});

const fruitClient = ServiceClient.create<FruitApi>("fruit");

describe("Service", () => {
  beforeAll(async () => {
    await fruitService.connect();
    await vegService.connect();
    await fruitClient.connect();
  });

  afterAll(async () => {
    await fruitService.disconnect();
    await fruitClient.disconnect();
    await vegService.disconnect();
  });

  it("does latency test", async () => {
    expect(typeof (await fruitService.testLatency())).toBe("number");
  });

  it("does ping from client", async () => {
    expect(await fruitClient.ping()).toBe("pong");
  });

  it("calls service method from another service", async () => {
    expect(await fruitClient.getKinds()).toStrictEqual(["apple", "orange", "pear"]);
  });

  it("calls service iterator method from another service", async () => {
    const responses: string[] = [];
    for await (const response of await fruitClient.getKindsIterator()) {
      responses.push(response);
    }
    expect(responses).toStrictEqual(["apple", "orange", "pear"]);
  });

  it("throws if connection fails", async () => {
    try {
      await ServiceClient.create<FruitApi>("fruit", {
        nats: { servers: ["nats://localhost:4225"] }, // wrong port
      }).connect();
      expect(false).toBe(true);
    } catch (_err) {
      // do nothing
    }
  });

  it("handles anomalies", async () => {
    try {
      await fruitClient.doErrors("anomaly");
      expect(false).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(Anomaly);
    }
  });

  it("handles errors", async () => {
    try {
      await fruitClient.doErrors("error");
      expect(false).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  // it('throws when testing latency without a domain', async () => {
  //   const anonService = new Service(null);

  //   try {
  //     await anonService.testLatency();
  //     fail('should have thrown');
  //   } catch (err) {
  //     // nothing
  //   }

  //   await anonService.disconnect();
  // });

  it("returns client connected state", async () => {
    const client = ServiceClient.create<FruitApi>("fruit");
    // client is connected on create.
    expect(client.isConnected).toBe(true);
    await client.disconnect();
    expect(client.isConnected).toBe(false);
  });

  it("returns service connected state", async () => {
    const service = new Service("some-service", { handlers: {} });
    // service is connected on create.
    expect(service.isConnected).toBe(true);
    await service.disconnect();
    expect(service.isConnected).toBe(false);
  });

  it("throws if no handler is found", async () => {
    const fruitClientBadApi = ServiceClient.create<{
      domain: "fruit";
      handlers: { nope(): Promise<void> };
    }>("fruit");

    try {
      await fruitClientBadApi.nope();
      expect(false).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(Anomaly);
      expect((err as Anomaly).message).toBe("No handler for method: fruit.nope");
    }

    fruitClientBadApi.disconnect();
  });

  it("should retrieve current context", () => {
    TestContext.apply({ originDomain: "some-domain", foo: "bar" }, {}, async () => {
      expect(TestContext.current.get("foo")).toBe("bar");
    });
  });

  it("applies context", async () => {
    await TestContext.apply({ language: "icelandic" }, {}, async () => {
      expect(await fruitClient.getFromContext("language")).toBe("icelandic");
      expect(TestContext.current.get("private")).toBeUndefined();
      expect(TestContext.current.get("shared")).toBe("4anyone");
    });
  });

  it("applies context iter", async () => {
    await TestContext.apply({ language: "icelandic" }, {}, async () => {
      const responses: string[] = [];

      for await (const response of await fruitClient.getKindsIterator()) {
        expect(TestContext.current.get("currentFruit")).toBe(response);
        responses.push(response);
      }
      expect(responses).toStrictEqual(["apple", "orange", "pear"]);
    });
  });

  it("uses client from service handler", async () => {
    expect(await fruitClient.getVeggies()).toStrictEqual(["carrot", "celery", "broccoli"]);
  });

  if (NATS_MONITOR_URI) {
    it("gets a list of peers", async () => {
      const peers = await fruitService.getPeers();
      expect(peers.find((p) => p.origin === fruitService.origin)).toBeDefined();
      expect(peers.find((p) => p.origin === vegService.origin)).toBeDefined();
    });

    it("gets peer stats", async () => {
      const peerStats = await fruitService.getPeerStats();
      expect(peerStats.map((ps) => ps.domain)).toContain("veg");
      expect(peerStats.map((ps) => ps.domain)).toContain("fruit");
    });
  } else {
    console.info("Skipping peer stats test because NATS_MONITOR_URI is not set.");
  }
});

// const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
