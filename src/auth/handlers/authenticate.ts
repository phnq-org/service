import Context from "../../Context";
import type { Handler } from "../../Service";
import ServiceError from "../../ServiceError";
import type AuthApi from "../AuthApi";
import type AuthService from "../AuthService";

const authenticate: Handler<AuthApi, "authenticate"> = async (authReq, service) => {
  const authService = service as AuthService;
  if (authService.onAuthenticate) {
    try {
      const { identity, authResponse } = await authService.onAuthenticate(authReq);
      Context.current.setSession("identity", identity);
      return { authenticated: true, identity, authResponse };
    } catch (err) {
      Context.current.setSession("identity", undefined);
      throw new ServiceError({
        type: "unauthorized",
        message: (err as Error).message || String(err),
      });
    }
  }
  throw new Error("No onAuthenticate handler configured.");
};

export default authenticate;
