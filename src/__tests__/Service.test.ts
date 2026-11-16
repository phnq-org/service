import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { matchCategory } from "@phnq/log";
import { Anomaly } from "@phnq/message";
import { createContextFactory, type RequestContext, type SessionContext } from "@/Context";
import { type Serializable, Service, ServiceClient } from "..";
import { NATS_MONITOR_URI } from "../config";
import type { Handler } from "../Service";
import ServiceError from "../ServiceError";

if (process.env.PHNQ_MESSAGE_LOG_NATS === "1") {
  matchCategory(/.+/);
}

// ========================== TEST INFRASTRUCTURE ==========================

interface TestRequestContext extends RequestContext {
  bubba?: string;
  private?: string;
  foo?: string;
  language?: string;
}
interface TestSessionContext extends SessionContext {
  currentFruit?: "apple" | "orange" | "pear";
  shared?: string;
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
    doErrors(type: "error" | "anomaly" | "service-error" | "none"): Promise<void>;
    getFromContext(key: string): Promise<Serializable | undefined>;
    getVeggies(): Promise<string[]>;
    getUnavailable(): Promise<"unavailable">;
  };
}

let endedBeforeLastResponse: boolean | undefined;

const getKinds: Handler<FruitApi, "getKinds"> = async () => ["apple", "orange", "pear"];

const getKindsIterator: Handler<FruitApi, "getKindsIterator"> = async () =>
  (async function* () {
    TestContext.current.setSession("currentFruit", "apple");
    yield "apple";
    TestContext.current.setSession("currentFruit", "orange");
    yield "orange";
    TestContext.current.setSession("currentFruit", "pear");
    // Snapshot whether the conversation has (wrongly) ended before the last response.
    endedBeforeLastResponse = serviceConversations.some(
      (c) => c.type === "end" && c.method === "getKindsIterator",
    );
    yield "pear";
  })();

const doErrors: Handler<FruitApi, "doErrors"> = async (type) => {
  switch (type) {
    case "anomaly":
      throw new Anomaly("the anomaly");

    case "error":
      throw new Error("the error");

    case "service-error":
      throw new ServiceError({ type: "bad-request", message: "the service error" });
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
  const vegClient = ServiceClient.create<VegApi>("veg");
  return await vegClient.getKinds();
};

const getUnavailable: Handler<FruitApi, "getUnavailable"> = async () => {
  return "unavailable";
};

const fruitService = new Service<FruitApi>("fruit", {
  handlers: { getKinds, getKindsIterator, doErrors, getFromContext, getVeggies, getUnavailable },
  isHandlerAvailable: (method) => method !== "getUnavailable",
});

const fruitClient = ServiceClient.create<FruitApi>("fruit");

interface ConversationEvent {
  type: "start" | "end";
  id: string;
  domain: string;
  method: string;
}

const serviceConversations: ConversationEvent[] = [];
TestContext.on("service:conversation:start", async ({ id, domain, method }) => {
  serviceConversations.push({ type: "start", id, domain, method });
});
TestContext.on("service:conversation:end", async ({ id, domain, method }) => {
  serviceConversations.push({ type: "end", id, domain, method });
});

const waitFor = async (cond: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("Service", () => {
  beforeEach(() => {
    serviceConversations.length = 0;
  });

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

  it("should retrieve current context", async () => {
    await TestContext.apply({ originDomain: "some-domain", foo: "bar" }, {}, async () => {
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

  it("should throw if method is unavailable", async () => {
    expect(async () => {
      await fruitClient.getUnavailable();
    }).toThrow("No handler for method: fruit.getUnavailable");
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

  const hasEnded = (method: string) =>
    serviceConversations.some((c) => c.type === "end" && c.method === method);

  it("dispatches service:conversation start and end for a regular handler", async () => {
    await fruitClient.getKinds();
    await waitFor(() => hasEnded("getKinds"));

    const events = serviceConversations.filter(
      (c) => c.domain === "fruit" && c.method === "getKinds",
    );
    expect(events.map((e) => e.type)).toStrictEqual(["start", "end"]);
    expect(events[0]?.id).toBeTruthy();
    expect(events[1]?.id).toBe(events[0]?.id as string);
  });

  it("dispatches service:conversation end only after the last iterator response", async () => {
    const responses: string[] = [];
    for await (const response of await fruitClient.getKindsIterator()) {
      responses.push(response);
    }
    await waitFor(() => hasEnded("getKindsIterator"));

    expect(responses).toHaveLength(3);
    const events = serviceConversations.filter(
      (c) => c.domain === "fruit" && c.method === "getKindsIterator",
    );
    expect(events.map((e) => e.type)).toStrictEqual(["start", "end"]);
    expect(events[1]?.id).toBe(events[0]?.id as string);
    expect(endedBeforeLastResponse).toBe(false);
  });

  it("dispatches service:conversation end when the handler throws", async () => {
    await fruitClient.doErrors("error").catch(() => undefined);
    await waitFor(() => hasEnded("doErrors"));

    const events = serviceConversations.filter((c) => c.method === "doErrors");
    expect(events.map((e) => e.type)).toStrictEqual(["start", "end"]);
  });

  it("dispatches service:conversation end when the handler throws a ServiceError", async () => {
    // ServiceErrors that aren't "server-error" are converted to Anomalies by the service.
    await fruitClient.doErrors("service-error").catch((err) => {
      expect(err).toBeInstanceOf(Anomaly);
    });
    await waitFor(() => hasEnded("doErrors"));

    const events = serviceConversations.filter((c) => c.method === "doErrors");
    expect(events.map((e) => e.type)).toStrictEqual(["start", "end"]);
  });

  it("uses a distinct conversation id for each request", async () => {
    await fruitClient.getKinds();
    await fruitClient.getKinds();
    await waitFor(() => serviceConversations.filter((c) => c.type === "end").length >= 2);

    const starts = serviceConversations.filter(
      (c) => c.type === "start" && c.method === "getKinds",
    );
    expect(starts).toHaveLength(2);
    expect(starts[0]?.id).not.toBe(starts[1]?.id as string);
  });
});
