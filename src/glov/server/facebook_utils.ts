import assert from 'assert';
import { createHmac } from 'crypto';
import { ErrorCallback } from 'glov/common/types';
import request from 'request';
import { executeWithRetry } from './execute_with_retry';
import { serverConfig } from './server_config';

export declare interface FacebookGraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export declare interface FacebookGraphResult extends Record<string, unknown> {
  error?: FacebookGraphError;
}

export declare interface FacebookGraphUser extends FacebookGraphResult {
  name?: string;
  first_name?: string;
  instant_game_player_id?: string;
}

export declare interface FacebookGraphDebugToken extends FacebookGraphResult {
  data?: {
    app_id?: string;
    is_valid?: boolean;
    user_id?: string;
  }
}

const BASE_GRAPH_URL = 'https://graph.fb.gg';
const MAX_RETRIES = 3; // Max number of retry attempts
const BASE_RETRY_BACKOFF_DURATION = 500; // To avoid breaching 200 calls/user/hour policy
const MAX_RETRY_BACKOFF_DURATION = 10000; // Max backoff duration after each retry attempt

let app_secret: string;
let access_token: string;
let access_token_url_parameter: string;

export function facebookUtilsInit(): void {
  app_secret = process.env.FACEBOOK_ACCESS_TOKEN ||
    serverConfig().facebook && serverConfig().facebook.access_token;
  access_token = process.env.FACEBOOK_GRAPH_ACCESS_TOKEN ||
    serverConfig().facebook && serverConfig().facebook.graph_access_token;

  access_token_url_parameter = `access_token=${access_token}`;
}

export function facebookGraphRequest(path: string, url_params_str: string,
  cb: ErrorCallback<FacebookGraphResult>): void {
  assert(access_token, 'Missing facebook.graph_access_token in config/server.json');

  if (url_params_str) {
    url_params_str = `${access_token_url_parameter}&${url_params_str}`;
  } else {
    url_params_str = access_token_url_parameter;
  }
  const url = `${BASE_GRAPH_URL}/${path}?${url_params_str}`;

  function makeRequest(handler: ErrorCallback<FacebookGraphResult>) {
    request({ url, json: true },
      (err: unknown, response: request.Response, body: FacebookGraphResult | undefined | null) => {
        if (err || response?.statusCode !== 200 || !body) {
          err = err || body?.error?.message;
          if (!err) {
            err = body?.error ? JSON.stringify(body?.error) : 'Request failed';
          }
          return handler(err);
        }
        return handler(null, body);
      });
  }

  const log_prefix = `Facebook | graphRequest | ${path}`;
  executeWithRetry(makeRequest,
    {
      max_retries: MAX_RETRIES,
      inc_backoff_duration: BASE_RETRY_BACKOFF_DURATION,
      max_backoff: MAX_RETRY_BACKOFF_DURATION,
      log_prefix: log_prefix,
      quiet: true,
    },
    cb);
}

// Returns the payload contained in the signed data if the signature is valid,
// or null otherwise.
export function facebookGetPayloadFromSignedData(signed_data: string): unknown | null {
  assert(app_secret, 'Missing facebook.access_token in config/server.json');

  try {
    const signatureComponents = signed_data.split('.');
    const signature = Buffer.from(signatureComponents[0], 'base64').toString('hex');
    const generated_signature = createHmac('sha256', app_secret).update(signatureComponents[1]).digest('hex');
    if (generated_signature === signature) {
      return JSON.parse(Buffer.from(signatureComponents[1], 'base64').toString('utf8'));
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Gets specific fields from the app-scoped user id.
// cb is called with an error as the first argument if any occurs,
// and with the resulting object as the second argument.
export function facebookGetUserFieldsFromASIDAsync(asid: string, fields: string,
  cb: ErrorCallback<FacebookGraphUser>): void {
  facebookGraphRequest(asid, `fields=${fields}`, cb);
}

// Gets the instant game player id from the app-scoped user id.
// cb is called with an error as the first argument if any occurs,
// and with the player id as the second argument.
export function facebookGetPlayerIdFromASIDAsync(asid:string, cb: ErrorCallback<string>): void {
  facebookGetUserFieldsFromASIDAsync(asid, 'instant_game_player_id',
    (err: unknown, result: FacebookGraphUser | undefined | null) => {
      if (err || !result?.instant_game_player_id) {
        return cb(err || 'No player id available');
      }
      return cb(null, result.instant_game_player_id);
    });
}

// Gets the app-scoped user id from the user token.
// cb is called with an error as the first argument if any occurs,
// and with the user id as the second argument.
export function facebookGetASIDFromUserTokenAsync(user_token: string, cb: ErrorCallback<string>): void {
  facebookGraphRequest('debug_token', `input_token=${user_token}`,
    (err: unknown, result: FacebookGraphDebugToken | undefined | null) => {
      if (err || !result) {
        return cb(err || 'Request failed');
      }
      let data = result.data;
      if (!(data && data.app_id && data.is_valid && data.user_id)) {
        return cb(`Invalid token (${JSON.stringify(data)})`);
      }
      return cb(null, data.user_id);
    });
}
