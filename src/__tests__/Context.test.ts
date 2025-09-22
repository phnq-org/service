import { describe, expect, test } from "bun:test";
import { sleep } from "bun";
import { createContextFactory } from "..";

describe("Context", () => {
  test("Extend context with function that returns a value", async () => {
    const TestContext = createContextFactory().extend((ctx) => ({
      getIdentity: () => ctx.identity,
    }));

    await TestContext.apply({}, { identity: "bubba" }, async () => {
      expect(TestContext.current.identity).toBe("bubba");
      expect(TestContext.current.getIdentity()).toBe("bubba");
    });
  });

  test("Extend context with function that sets a value", async () => {
    const TestContext = createContextFactory().extend((ctx) => ({
      setIdentity: (newId: string) => ctx.setSession("identity", newId),
    }));

    await TestContext.apply({}, { identity: "bubba" }, async () => {
      expect(TestContext.current.identity).toBe("bubba");
      TestContext.current.setIdentity("newBubba");
      expect(TestContext.current.identity).toBe("newBubba");
    });
  });

  test("Extend context with async function that sets a value", async () => {
    const TestContext = createContextFactory().extend((ctx) => ({
      setIdentity: async (newId: string) => {
        await sleep(100);
        ctx.setSession("identity", newId);
      },
    }));

    await TestContext.apply({}, { identity: "bubba" }, async () => {
      expect(TestContext.current.identity).toBe("bubba");
      await TestContext.current.setIdentity("newBubba");
      expect(TestContext.current.identity).toBe("newBubba");
    });
  });

  test("Extend context with getter", async () => {
    const TestContext = createContextFactory().extend((ctx) => ({
      get altIdentity() {
        return ["alt", ctx.identity].join(":");
      },
    }));

    await TestContext.apply({}, { identity: "bubba" }, async () => {
      expect(TestContext.current.identity).toBe("bubba");
      expect(TestContext.current.altIdentity).toBe("alt:bubba");
    });
  });

  test("Context extension initializer", async () => {
    const TestContext = createContextFactory<{ user: string }>().extend((ctx) => ({
      init: async () => {
        await sleep(100);
        ctx.setRequest("user", `user:${ctx.identity}`);
      },

      get user() {
        return ctx.get("user") ?? "cunt";
      },
    }));

    const result = await TestContext.apply({}, { identity: "123" }, async () => {
      expect(TestContext.current.user).toBe("user:123");
      return true;
    });

    expect(result).toBe(true);
  });
});
