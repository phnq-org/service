import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApiService, AuthService } from "..";
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

describe("AuthService", () => {
  beforeAll(async () => {
    await authService.connect();
    await authClient.connect();
    await apiService.start();
    await authWsClient.connect();

    serviceErrors.length = 0;

    ApiClient.on("error", ({ err }) => {
      serviceErrors.push(err);
    });
  });

  afterAll(async () => {
    await authService.disconnect();
    await authClient.disconnect();
    await authWsClient.disconnect();
    await apiService.stop();

    expect(serviceErrors.map((err) => err.type)).toEqual(["unauthorized"]);
  });

  test("ping", async () => {
    expect(await authClient.ping()).toBe("pong");
  });

  describe("WebSocket Auth", () => {
    test("Auth success", async () => {
      const { identity, authenticated, error, authResponse } =
        await authWsClient.authenticate("good-token");
      expect(identity).toBe("The User");
      expect(authResponse).toBe("The Response");
      expect(authenticated).toBe(true);
      expect(error).toBeUndefined();
    });

    test.only("Auth fail", async () => {
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
    });
  });
});
