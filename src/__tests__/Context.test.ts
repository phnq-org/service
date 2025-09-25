import { describe, expect, test } from "bun:test";
import { sleep } from "bun";
import { Context, createContextFactory } from "..";

/**
 * Using the `default` contect factory for Context.apply() because that's
 * how the thread's contect will gnerally be set up.
 */

describe("Context", () => {
  test("Extend context with function that returns a value", async () => {
    const TestContext = createContextFactory().extend((ctx) => ({
      getIdentity: () => ctx.identity,
    }));

    await Context.apply({}, { identity: "bubba" }, async () => {
      expect(TestContext.current.identity).toBe("bubba");
      expect(TestContext.current.getIdentity()).toBe("bubba");
    });
  });

  test("Extend context with function that sets a value", async () => {
    const TestContext = createContextFactory().extend((ctx) => ({
      setIdentity: (newId: string) => ctx.setSession("identity", newId),
    }));

    await Context.apply({}, { identity: "bubba" }, async () => {
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

    await Context.apply({}, { identity: "bubba" }, async () => {
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

    await Context.apply({}, { identity: "bubba" }, async () => {
      expect(TestContext.current.identity).toBe("bubba");
      expect(TestContext.current.altIdentity).toBe("alt:bubba");
    });
  });

  test.only("Context extension initializer", async () => {
    const TestContext = createContextFactory<{ user: string }>().extend((ctx) => ({
      get user() {
        return ctx.get("user");
      },
    }));

    TestContext.on("enter", async ({ context }) => {
      await sleep(100);
      context.setRequest("user", `user:${context.identity}`);
    });

    TestContext.on("exit", async ({ context, exitedContext }) => {
      expect(context).toBe(exitedContext);
      expect(context.id).toBe(exitedContext.id);
      expect(context.state).toBe("exited");
      expect(context.identity).toBe("123");
      expect(Context.current.id).not.toBe(exitedContext.id);
      expect(Context.current.state).toBe("detached");
    });

    const result = await Context.apply({}, { identity: "123" }, async () => {
      expect(TestContext.current.state).toBe("current");
      expect(TestContext.current.user).toBe("user:123");
      return true;
    });

    expect(result).toBe(true);
  });
});
