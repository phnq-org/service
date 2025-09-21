import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { ApiService, AuthService, Context, type Handler, Service } from "..";
import AuthClient from "../auth/AuthClient";
import { ApiClient } from "../browser";
import ServiceError from "../ServiceError";

// ========================== TEST INFRASTRUCTURE ==========================

const authService = new AuthService({
  onAuthenticate: async (req: string) => {
    if (req === "good-token") {
      return { identity: "The User", authResponse: "The Response" };
    }
    throw new ServiceError({ type: "unauthorized", message: "not authenticated" });
  },
});

const authClient = AuthClient.create();

const apiService = new ApiService({ port: 55778 });

const authWsClient = ApiClient.createAuthClient("ws://localhost:55778");

const serviceErrors: ServiceError[] = [];

interface FruitApi {
  domain: "fruit";
  handlers: {
    getKinds(): Promise<string[]>;
  };
}

const getKinds: Handler<FruitApi, "getKinds"> = async () => {
  if (!Context.current.identity) {
    throw new ServiceError({ type: "unauthorized", message: "not authenticated" });
  }
  return ["apple", "orange", "pear"];
};

const fruitService = new Service<FruitApi>("fruit", {
  handlers: { getKinds },
});

const fruitWsClient = ApiClient.create<FruitApi>("fruit", "ws://localhost:55778");

describe("AuthService", () => {
  beforeAll(async () => {
    await authService.connect();
    await apiService.start();
    await fruitService.connect();

    serviceErrors.length = 0;

    ApiClient.on("error", ({ err }) => {
      serviceErrors.push(err);
    });
  });

  afterAll(async () => {
    await authService.disconnect();
    await fruitService.disconnect();
    await apiService.stop();
  });

  afterEach(async () => {
    await authClient.disconnect();
    await authWsClient.disconnect();
  });

  describe("WebSocket Auth", () => {
    test("ping", async () => {
      expect(await authClient.ping()).toBe("pong");
    });

    test("Auth success", async () => {
      const { identity, authenticated, error, authResponse } =
        await authWsClient.authenticate("good-token");
      expect(identity).toBe("The User");
      expect(authResponse).toBe("The Response");
      expect(authenticated).toBe(true);
      expect(error).toBeUndefined();
    });

    test("Auth fail", async () => {
      const numServiceErrors = serviceErrors.length;
      try {
        await authWsClient.authenticate("bad-token");
        expect(false).toBe(true);
      } catch (err) {
        if (err instanceof ServiceError) {
          expect(err.type).toBe("unauthorized");
          expect(err.message).toBe("not authenticated");
        } else {
          expect(false).toBe(true);
        }
      }

      expect(serviceErrors.length).toBe(numServiceErrors + 1);
      const lastError = serviceErrors[serviceErrors.length - 1];
      expect(lastError?.type).toBe("unauthorized");
      expect(lastError?.message).toBe("not authenticated");
    });
  });

  describe("Use auth in service", () => {
    test("Service method requires identity", async () => {
      await authWsClient.authenticate("good-token");
      const fruitKinds = await fruitWsClient.getKinds();
      expect(fruitKinds).toEqual(["apple", "orange", "pear"]);
    });

    test("Service method throws without identity", async () => {
      try {
        await fruitWsClient.getKinds();
        expect(false).toBe(true);
      } catch (err) {
        if (err instanceof ServiceError) {
          expect(err.type).toBe("unauthorized");
          expect(err.message).toBe("not authenticated");
        } else {
          expect(false).toBe(true);
        }
      }
    });

    test("Clear session identity", async () => {
      await authWsClient.authenticate("good-token");
      const fruitKinds = await fruitWsClient.getKinds();
      expect(fruitKinds).toEqual(["apple", "orange", "pear"]);

      await authWsClient.clearIdentity();

      try {
        await fruitWsClient.getKinds();
        expect(false).toBe(true);
      } catch (err) {
        if (err instanceof ServiceError) {
          expect(err.type).toBe("unauthorized");
          expect(err.message).toBe("not authenticated");
        } else {
          expect(false).toBe(true);
        }
      }
    });
  });
});
