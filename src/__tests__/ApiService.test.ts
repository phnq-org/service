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
  handlers: { getKinds, getKindsIterator, doErrors, getVeggies, _noAccess, getApiVersion },
});

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
});
