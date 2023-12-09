import assert from 'assert';
import {
  ERR_INVALID_PROVIDER,
  ERR_NOT_AVAILABLE,
  ERR_UNAUTHORIZED,
} from 'glov/common/external_users_common';
import { ErrorCallback } from 'glov/common/types';
import { ExternalUserInfo } from './external_user_info';
import { registerExternalUserInfoProvider } from './social';

export interface LoginData {
  provider: string;
  external_id?: string;
  validation_data?: string;
}

export interface LoginOptions {
  user_initiated: boolean;
  email?: string;
  password?: string;
  creation_display_name?: string | null;
  external_login_data?: LoginData;
}

export interface ExternalUsersClient {
  getProvider(): string;
  enabled(): boolean;
  logIn(login_options: LoginOptions, cb: ErrorCallback<LoginData, string>): void;
  logOut(): void;
  sendActivationEmail?(email: string, cb: ErrorCallback<string, string>): void;
  loggedIn(): boolean;
  getCurrentUser(cb: ErrorCallback<ExternalUserInfo, string>): void;
  getFriends?(cb: ErrorCallback<ExternalUserInfo[], string>): void;
  getPartyId?(cb: ErrorCallback<string, string>): void;
  sendRecoverEmail?(email: string, cb: ErrorCallback<string, string>): void;
  checkEmailVerified?(cb: ErrorCallback<string, string>): void;
}

const invalid_provider = {
  getProvider(): string {
    assert(false);
  },
  enabled(): boolean {
    return false;
  },
  loggedIn(): boolean {
    return false;
  },
  logIn(login_options: LoginOptions, cb: ErrorCallback<LoginData, string>): void {
    cb(ERR_INVALID_PROVIDER);
  },
  logOut(): void {
    // Nothing to do here
  },
  getCurrentUser(cb: ErrorCallback<ExternalUserInfo, string>): void {
    cb(ERR_INVALID_PROVIDER);
  },
};

let setup_clients: Partial<Record<string, ExternalUsersClient>> = {};
let setup_auto_login_provider: string | undefined;
let setup_auto_login_fallback_provider: string | undefined;
let setup_email_pass_login_provider: string | undefined;

function getClient(provider: string): ExternalUsersClient {
  return setup_clients[provider] || invalid_provider;
}

export function externalUsersEnabled(provider: string): boolean {
  let client = setup_clients[provider];
  return client && client.enabled() || false;
}

export function externalUsersLoggedIn(provider: string): boolean {
  let client = setup_clients[provider];
  return client && client.loggedIn() || false;
}

export function externalUsersAutoLoginProvider(): string | undefined {
  return setup_auto_login_provider;
}

export function externalUsersAutoLoginFallbackProvider(): string | undefined {
  return setup_auto_login_fallback_provider;
}

export function externalUsersEmailPassLoginProvider(): string | undefined {
  return setup_email_pass_login_provider;
}

export function externalUsersSendEmailConfirmation(email: string, cb: ErrorCallback<string, string>): void {
  assert(setup_email_pass_login_provider);
  const client = getClient(setup_email_pass_login_provider);
  assert(client.sendActivationEmail);
  client.sendActivationEmail(email, cb);
}

export function externalUsersCheckEmailVerified(cb: ErrorCallback<string, string>): void {
  assert(setup_email_pass_login_provider);
  const client = getClient(setup_email_pass_login_provider);
  assert(client.checkEmailVerified);
  client.checkEmailVerified(cb);
}

export function externalUsersSendRecoverEmail(email: string, cb: ErrorCallback<string, string>): void {
  assert(setup_email_pass_login_provider);
  const client = getClient(setup_email_pass_login_provider);
  assert(client.sendRecoverEmail);
  client.sendRecoverEmail(email, cb);
}

export function externalUsersLogIn(
  provider: string,
  login_options: LoginOptions,
  cb: ErrorCallback<LoginData, string>,
): void {
  getClient(provider).logIn(login_options, cb);
}

export function externalUsersLogOut(provider?: string): void {
  if (provider) {
    getClient(provider).logOut();
  } else {
    for (const key in setup_clients) {
      getClient(key).logOut();
    }
  }
}

export function externalUsersCurrentUser(provider: string, cb: ErrorCallback<ExternalUserInfo, string>): void {
  getClient(provider).getCurrentUser(cb);
}

export function externalUsersFriends(provider: string, cb: ErrorCallback<ExternalUserInfo[], string>): void {
  let client = getClient(provider);
  if (client.getFriends) {
    client.getFriends(cb);
  } else {
    cb(ERR_NOT_AVAILABLE);
  }
}

export function externalUsersPartyId(provider: string, cb: ErrorCallback<string, string>): void {
  let client = getClient(provider);
  if (client.getPartyId) {
    client.getPartyId(cb);
  } else {
    cb(ERR_NOT_AVAILABLE);
  }
}

export function externalUsersSetupProvider(client: ExternalUsersClient): void {
  let provider = client.getProvider();
  setup_clients[provider] = client;
  registerExternalUserInfoProvider(
    provider,
    function (cb) {
      if (client.loggedIn()) {
        client.getCurrentUser(cb);
      } else {
        cb(ERR_UNAUTHORIZED);
      }
    },
    client.getFriends && function (cb) {
      if (client.loggedIn()) {
        client.getFriends!(cb);
      } else {
        cb(ERR_UNAUTHORIZED);
      }
    },
  );
}

export function externalUsersSetup(
  clients: ExternalUsersClient[],
  auto_login_provider?: string,
  auto_login_fallback_provider?: string,
  email_pass_login_provider?: string
): void {
  setup_auto_login_provider = auto_login_provider;
  setup_auto_login_fallback_provider = auto_login_fallback_provider;
  setup_email_pass_login_provider = email_pass_login_provider;
  clients.forEach(externalUsersSetupProvider);
}
