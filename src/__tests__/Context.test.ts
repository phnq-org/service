import { describe, expect, test } from "bun:test";
import { sleep } from "bun";
import { createContextFactory } from "..";

describe("Context", () => {
  test("Extend context with function that returns a value", () => {
    const TestContext = createContextFactory().extend((ctx) => ({
      getIdentity: () => ctx.identity,
    }));

    TestContext.apply({}, { identity: "bubba" }, async () => {
      expect(TestContext.current.identity).toBe("bubba");
      expect(TestContext.current.getIdentity()).toBe("bubba");
    });
  });

  test("Extend context with function that sets a value", () => {
    const TestContext = createContextFactory().extend((ctx) => ({
      setIdentity: (newId: string) => ctx.setSession("identity", newId),
    }));

    TestContext.apply({}, { identity: "bubba" }, async () => {
      expect(TestContext.current.identity).toBe("bubba");
      TestContext.current.setIdentity("newBubba");
      expect(TestContext.current.identity).toBe("newBubba");
    });
  });

  test("Extend context with async function that sets a value", () => {
    const TestContext = createContextFactory().extend((ctx) => ({
      setIdentity: async (newId: string) => {
        await sleep(100);
        ctx.setSession("identity", newId);
      },
    }));

    TestContext.apply({}, { identity: "bubba" }, async () => {
      expect(TestContext.current.identity).toBe("bubba");
      await TestContext.current.setIdentity("newBubba");
      expect(TestContext.current.identity).toBe("newBubba");
    });
  });

  test("Extend context with getter", () => {
    const TestContext = createContextFactory().extend((ctx) => ({
      get altIdentity() {
        return ["alt", ctx.identity].join(":");
      },
    }));

    TestContext.apply({}, { identity: "bubba" }, async () => {
      expect(TestContext.current.identity).toBe("bubba");
      expect(TestContext.current.altIdentity).toBe("alt:bubba");
    });
  });
});
