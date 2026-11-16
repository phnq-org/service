import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { get } from "node:http";
import { Anomaly } from "@phnq/message";
import ApiService from "../api/ApiService";
import { ApiClient } from "../browser";
import Context, { createContextFactory } from "../Context";
import Service, { type Handler } from "../Service";
import ServiceClient from "../ServiceClient";

// ========================== TEST INFRASTRUCTURE ==========================

const TestContext = createContextFactory<{
  bubba: string;
  private: string;
}>();

const apiService = new ApiService({ port: 55777, paths: ["/", "/v2"] });

interface FruitNotification {
  type: "bubba";
  bubba: string;
}

const vegWsClient = ApiClient.create<VegApi, FruitNotification>(
  "vegWs",
  "ws://localhost:55777",
  (n) => {
    notificationsVeg.push(n);
  },
);

const fruitWsClient = ApiClient.create<FruitApi, FruitNotification>(
  "fruitWs",
  "ws://localhost:55777",
  (n) => {
    notificationsFruit.push(n);
  },
);

const fruitWsClientV2 = ApiClient.create<FruitApi, FruitNotification>(
  "fruitWs",
  "ws://localhost:55777/v2",
);

const fruitClient = ServiceClient.create<FruitApi>("fruitWs");

const fruitWsClientWrongPort = ApiClient.create<FruitApi>("fruitWs", "ws://localhost:55778");
const fruitWsClientWrongPath = ApiClient.create<FruitApi>(
  "fruitWs",
  "ws://localhost:55777/wrong-path",
);

interface VegApi {
  domain: "vegWs";
  handlers: {
    getKinds(): Promise<string[]>;
  };
}

const getVegKinds: Handler<VegApi, "getKinds"> = async () => {
  if (TestContext.current.get("bubba") !== "gump") {
    throw new Error("Nope");
  }

  await Context.current.notify<FruitNotification>({ type: "bubba", bubba: "gump" });

  return ["carrot", "celery", "broccoli"];
};

const vegService = new Service<VegApi>("vegWs", {
  handlers: { getKinds: getVegKinds },
});

interface FruitApi {
  domain: "fruitWs";
  handlers: {
    getKinds(): Promise<string[]>;
    getKindsIterator(): Promise<AsyncIterableIterator<string>>;
    getFailingIterator(): Promise<AsyncIterableIterator<string>>;
    doErrors(type: "error" | "anomaly" | "none"): Promise<void>;
    // getFromContext(key: string): Promise<Serializable | undefined>;
    getVeggies(): Promise<string[]>;
    _noAccess(): Promise<string>;
    getApiVersion(): Promise<"v1" | "v2">;
  };
}

const getKinds: Handler<FruitApi, "getKinds"> = async () => ["apple", "orange", "pear"];

const getKindsIterator: Handler<FruitApi, "getKindsIterator"> = async () =>
  (async function* () {
    yield "apple";
    yield "orange";
    // Snapshot whether any conversation has (wrongly) ended before the last response.
    endedBeforeLastResponse = allEvents.some((e) => e.includes(":end:getKindsIterator"));
    yield "pear";
  })();

const getFailingIterator: Handler<FruitApi, "getFailingIterator"> = async () =>
  (async function* () {
    yield "apple";
    throw new Error("iterator failed");
  })();

const doErrors: Handler<FruitApi, "doErrors"> = async (type) => {
  switch (type) {
    case "anomaly":
      throw new Anomaly("the anomaly");

    case "error":
      throw new Error("the error");
  }
};

const getVeggies: Handler<FruitApi, "getVeggies"> = async () => {
  TestContext.current.setRequest("bubba", "gump");

  const vegClient = ServiceClient.create<VegApi>("vegWs");

  return await vegClient.getKinds();
};

const _noAccess: Handler<FruitApi, "_noAccess"> = async () => {
  return "secret";
};

const getApiVersion: Handler<FruitApi, "getApiVersion"> = async () => {
  const path = Context.current.get("connectionPath");
  return path === "/v2" ? "v2" : "v1";
};

const fruitService = new Service<FruitApi>("fruitWs", {
  handlers: {
    getKinds,
    getKindsIterator,
    getFailingIterator,
    doErrors,
    getVeggies,
    _noAccess,
    getApiVersion,
  },
});

let endedBeforeLastResponse: boolean | undefined;

interface ConversationEvent {
  type: "start" | "end";
  id: string;
  domain: string;
  method: string;
}

const apiConversations: ConversationEvent[] = [];
const serviceConversations: ConversationEvent[] = [];
const allEvents: string[] = [];
TestContext.on("api:conversation:start", async ({ id, domain, method }) => {
  apiConversations.push({ type: "start", id, domain, method });
  allEvents.push(`api:start:${method}`);
});
TestContext.on("api:conversation:end", async ({ id, domain, method }) => {
  apiConversations.push({ type: "end", id, domain, method });
  allEvents.push(`api:end:${method}`);
});
TestContext.on("service:conversation:start", async ({ id, domain, method }) => {
  serviceConversations.push({ type: "start", id, domain, method });
  allEvents.push(`service:start:${method}`);
});
TestContext.on("service:conversation:end", async ({ id, domain, method }) => {
  serviceConversations.push({ type: "end", id, domain, method });
  allEvents.push(`service:end:${method}`);
});

const waitFor = async (cond: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const notificationsFruit: FruitNotification[] = [];
const notificationsVeg: FruitNotification[] = [];

describe("ApiService", () => {
  beforeAll(async () => {
    await fruitService.connect();
    await vegService.connect();
    await apiService.start();
    await fruitWsClientWrongPort.connect();
    await vegWsClient.connect();
  });

  afterAll(async () => {
    await fruitService.disconnect();
    await vegService.disconnect();
    await apiService.stop();
    await fruitWsClient.disconnect();
    await fruitWsClientWrongPort.disconnect();
    await vegWsClient.disconnect();
    await fruitClient.disconnect();
  });

  beforeEach(() => {
    notificationsFruit.length = 0;
    notificationsVeg.length = 0;
    apiConversations.length = 0;
    serviceConversations.length = 0;
    allEvents.length = 0;
  });

  it("throws if client url port is wrong", async () => {
    try {
      await fruitWsClientWrongPort.ping();
      expect(false).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("throws if client url path is wrong", async () => {
    try {
      await fruitWsClientWrongPath.ping();
      expect(false).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("does ping from client", async () => {
    expect(await fruitWsClient.ping()).toBe("pong");
  });

  it("calls service method from another service", async () => {
    expect(await fruitWsClient.getKinds()).toStrictEqual(["apple", "orange", "pear"]);
  });

  it("calls service iterator method from another service", async () => {
    const responses: string[] = [];
    for await (const response of await fruitWsClient.getKindsIterator()) {
      responses.push(response);
    }
    expect(responses).toStrictEqual(["apple", "orange", "pear"]);
  });

  it("handles anomalies", async () => {
    try {
      await fruitWsClient.doErrors("anomaly");
      throw "unreachable";
    } catch (err) {
      expect(err).not.toBe("unreachable");
    }
  });

  it("handles errors", async () => {
    try {
      await fruitWsClient.doErrors("error");
      throw "unreachable";
    } catch (err) {
      expect(err).not.toBe("unreachable");
    }
  });

  it("uses client from service handler", async () => {
    expect(await fruitWsClient.getVeggies()).toStrictEqual(["carrot", "celery", "broccoli"]);
    expect(notificationsFruit).toStrictEqual([{ bubba: "gump", type: "bubba" }]);
    expect(notificationsVeg).toStrictEqual([]);
  });

  it("responds with a 200 status for ping path", async () => {
    const statusCode = await new Promise<number | undefined>((resolve) => {
      get("http://localhost:55777", (resp) => {
        resolve(resp.statusCode);
      });
    });
    expect(statusCode).toBe(200);
  });

  it("Does not allow access to methods starting with underscore (via API)", async () => {
    try {
      await fruitWsClient._noAccess();
      throw "unreachable";
    } catch (err) {
      expect(err).not.toBe("unreachable");
    }
  });

  it("Does allow access to methods starting with underscore (via ServiceClient)", async () => {
    const secret = await fruitClient._noAccess();
    expect(secret).toBe("secret");
  });

  it("Correctly identifies the connection path", async () => {
    expect(await fruitWsClient.getApiVersion()).toBe("v1");
    expect(await fruitWsClientV2.getApiVersion()).toBe("v2");
  });

  const hasEnded = (events: ConversationEvent[], method: string) =>
    events.some((c) => c.type === "end" && c.method === method);

  it("dispatches api and service conversation start/end events", async () => {
    await fruitWsClient.getKinds();
    await waitFor(
      () => hasEnded(apiConversations, "getKinds") && hasEnded(serviceConversations, "getKinds"),
    );

    const apiEvents = apiConversations.filter((c) => c.method === "getKinds");
    expect(apiEvents.map((e) => e.type)).toStrictEqual(["start", "end"]);
    expect(apiEvents[0]?.domain).toBe("fruitWs");
    expect(apiEvents[1]?.id).toBe(apiEvents[0]?.id as string);

    const serviceEvents = serviceConversations.filter((c) => c.method === "getKinds");
    expect(serviceEvents.map((e) => e.type)).toStrictEqual(["start", "end"]);
    expect(serviceEvents[0]?.domain).toBe("fruitWs");
    expect(serviceEvents[1]?.id).toBe(serviceEvents[0]?.id as string);

    // Separate conversations, so separate ids.
    expect(apiEvents[0]?.id).not.toBe(serviceEvents[0]?.id as string);

    // The API conversation wraps the service conversation.
    expect(allEvents.filter((e) => e.endsWith(":getKinds"))).toStrictEqual([
      "api:start:getKinds",
      "service:start:getKinds",
      "service:end:getKinds",
      "api:end:getKinds",
    ]);
  });

  it("dispatches conversation end only after the last iterator response", async () => {
    const responses: string[] = [];
    for await (const response of await fruitWsClient.getKindsIterator()) {
      responses.push(response);
    }
    await waitFor(
      () =>
        hasEnded(apiConversations, "getKindsIterator") &&
        hasEnded(serviceConversations, "getKindsIterator"),
    );

    expect(responses).toStrictEqual(["apple", "orange", "pear"]);
    for (const conversations of [apiConversations, serviceConversations]) {
      const events = conversations.filter((c) => c.method === "getKindsIterator");
      expect(events.map((e) => e.type)).toStrictEqual(["start", "end"]);
      expect(events[1]?.id).toBe(events[0]?.id as string);
    }
    expect(endedBeforeLastResponse).toBe(false);
  });

  it("dispatches conversation end even when the handler errors", async () => {
    await fruitWsClient.doErrors("error").catch(() => undefined);
    await waitFor(
      () => hasEnded(apiConversations, "doErrors") && hasEnded(serviceConversations, "doErrors"),
    );

    for (const conversations of [apiConversations, serviceConversations]) {
      const events = conversations.filter((c) => c.method === "doErrors");
      expect(events.map((e) => e.type)).toStrictEqual(["start", "end"]);
    }
  });

  it("dispatches conversation end when an iterator fails mid-stream", async () => {
    const responses: string[] = [];
    try {
      for await (const response of await fruitWsClient.getFailingIterator()) {
        responses.push(response);
      }
    } catch {
      // expected
    }
    await waitFor(
      () =>
        hasEnded(apiConversations, "getFailingIterator") &&
        hasEnded(serviceConversations, "getFailingIterator"),
    );

    for (const conversations of [apiConversations, serviceConversations]) {
      const events = conversations.filter((c) => c.method === "getFailingIterator");
      expect(events.map((e) => e.type)).toStrictEqual(["start", "end"]);
    }
  });
});
