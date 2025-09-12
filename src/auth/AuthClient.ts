import ServiceClient, { type StandaloneClient } from "../ServiceClient";
import type AuthApi from "./AuthApi";

const AuthClient = {
  create(): AuthApi["handlers"] & StandaloneClient {
    return ServiceClient.create<AuthApi>("phnq-auth");
  },
};

export default AuthClient;
