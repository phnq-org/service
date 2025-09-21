import Context from "../../Context";
import type { Handler } from "../../Service";
import type AuthApi from "../AuthApi";

const clearIdentity: Handler<AuthApi, "clearIdentity"> = async () => {
  Context.current.setSession("identity", null);
};

export default clearIdentity;
