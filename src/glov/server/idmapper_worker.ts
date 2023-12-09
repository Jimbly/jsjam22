import assert from 'assert';
import { DataObject, ErrorCallback, HandlerSource } from 'glov/common/types';
import { ChannelWorker } from './channel_worker';
import { randNumericId } from './server_util';

import type { ChannelServer } from './channel_server';

// RFC 4648: base64 (standard) to base64url (URL and filename safe standard)
export function base64ToBase64Url(str: string): string {
  assert(str.match(/^[A-Za-z0-9+/=]+$/), `String '${str}' is not in standard base64`);
  return str.replace(/\+/g, '-').replace(/\//g, '_');
}

function getProviderIdMapStoreKey(provider: string, provider_id: string): string {
  switch (provider) {
    //case USERS_PROVIDER_YANDEX:
    //  provider_id = base64ToBase64Url(provider_id);
    //  assert(provider_id.match(/^[0-9A-Za-z_=-]+$/), 'Ids from Yandex must be transformed to base64url format');
    //  break;
    default:
      assert(provider_id.match(/^[0-9A-Za-z_.=+-]+$/), "Ids must not contain a '/' character");
  }
  return `idmaps_providers/${provider}.${provider_id}`;
}

function getUserIdMapStoreKey(user_id: string): string {
  return `idmaps_users/${user_id}`;
}

export interface ProviderIdData {
  created: number;
  user_id: string;
  deleted?: number;
}

interface UserIdData {
  created: number;
}

class IdMapperWorker extends ChannelWorker {
  recently_allocated_ids: Record<string, boolean>;

  constructor(channel_server: ChannelServer, channel_id: string, channel_data: DataObject) {
    super(channel_server, channel_id, channel_data);

    this.recently_allocated_ids = {};
  }

  getData<T>(ds_key: string, resp_func: ErrorCallback<T>): void {
    this.channel_server.ds_store_meta.getAsync(ds_key, undefined, resp_func);
  }

  getDataMultiple<T>(ds_keys: string[], resp_func: ErrorCallback<T[]>): void {
    this.channel_server.ds_store_meta.getMultipleAsync(ds_keys, resp_func);
  }

  setData<T>(ds_key: string, data: T, resp_func: ErrorCallback): void {
    this.channel_server.ds_store_meta.setAsync(ds_key, data, resp_func);
  }

  getNonDeletedProviderId(provider_id_ds_key: string, resp_func: ErrorCallback<ProviderIdData>): void {
    this.getData<ProviderIdData>(provider_id_ds_key, (err, result) => {
      if (err) {
        return resp_func(err);
      }
      if (result && result.deleted) {
        return resp_func(null, null);
      }
      return resp_func(null, result);
    });
  }

  getNonDeletedProviderIdMultiple(provider_id_ds_keys: string[], resp_func: ErrorCallback<ProviderIdData[]>): void {
    this.getDataMultiple<ProviderIdData>(provider_id_ds_keys, (err, result) => {
      if (err) {
        return resp_func(err);
      }
      if (result) {
        const non_deleted_result = result.filter((provider_id_data) => provider_id_data && !provider_id_data.deleted);
        return resp_func(null, non_deleted_result);
      }
      return resp_func(null, result);
    });
  }

  /**
   * Retrieves a user id for which a given provider id is mapped to.
   * @param {HandlerSource} source Source
   * @param {object} data Input data that must contain: a provider property identifying the provider;
   * a provider_id property with the id for the given provider.
   * @param {function} resp_func Callback function that receives an error if any occurred,
   * and the resulting object containing a user_id property with the corresponding user id, if such exists.
   * @returns {undefined}
   */
  handleIdMapGetId(
    source: HandlerSource,
    data: { provider: string; provider_id: string },
    resp_func: ErrorCallback<ProviderIdData>,
  ): void {
    let { provider, provider_id } = data;
    let provider_id_ds_key = getProviderIdMapStoreKey(provider, provider_id);
    this.debugSrc(source, `Getting id mapping for ${provider}/${provider_id} in ${provider_id_ds_key}`);
    this.getNonDeletedProviderId(provider_id_ds_key, resp_func);
  }

  /**
   * Retrieves a user id for which a given provider id is mapped to, creating a new user id if none exists.
   * @param {HandlerSource} source Source
   * @param {object} data Input data that must contain: a provider property identifying the provider;
   * a provider_id property with the id for the given provider.
   * @param {function} resp_func Callback function that receives an error if any occurred,
   * and the resulting object containing a user_id property with the corresponding user id.
   * @returns {undefined}
   */
  handleIdMapGetCreateId(
    source: HandlerSource,
    data: { provider: string; provider_id: string },
    resp_func: ErrorCallback<ProviderIdData>,
  ): void {
    let { provider, provider_id } = data;
    let provider_id_ds_key = getProviderIdMapStoreKey(provider, provider_id);
    this.debugSrc(source, `Getting or creating id mapping for ${provider}/${provider_id} in ${provider_id_ds_key}`);

    // Ensure no concurrent access regarding the given provider id
    this.aquireResourceAsync(provider_id_ds_key, (release_callback: () => void) => {
      let orig_resp_func = resp_func;
      resp_func = (err, result) => {
        release_callback();
        orig_resp_func(err, result);
      };

      // Check if we already have an ID saved
      this.getNonDeletedProviderId(provider_id_ds_key, (err, provider_id_data) => {
        if (err) {
          this.errorSrc(source, `Error getting ${provider_id_ds_key}:`, err);
          return void resp_func(err);
        }
        if (provider_id_data) {
          return void resp_func(null, provider_id_data);
        }

        // new, generate an id, check that no user exists with that ID already
        let self = this;
        const len = 16;
        const max_tries = 16;
        function tryAlloc(tries: number): void {
          let user_id: string;
          do {
            // Note: Prior to 2023/8, this used a version of randNumericId() which may return IDs starting with a `0`
            user_id = randNumericId(len);
          } while (self.recently_allocated_ids[user_id]);
          // Keep an in-memory map of allocations currently in-flight, in case of momentary random collision
          self.recently_allocated_ids[user_id] = true;

          // Ensure no one else is mapped to this ID already
          let user_id_ds_key = getUserIdMapStoreKey(user_id);
          self.getData<UserIdData>(user_id_ds_key, (err, user_id_data) => {
            if (err || user_id_data) {
              // Probably this id is already mapped to by someone else
              if (tries <= 1) {
                // something critically wrong? Stop retrying.
                self.errorSrc(source,
                  `Critical failure trying to allocate id for provider id ${provider}/${provider_id}:`, err);
                return void resp_func(err);
              }
              return void tryAlloc(tries - 1);
            }
            // user id is not taken, take it, save it

            user_id_data = {
              created: Date.now(),
            };
            // First, save the user mapping, so no one can possibly map to this ID
            self.setData(user_id_ds_key, user_id_data, (err) => {
              if (err) { // should never happen
                self.errorSrc(source, `Error setting ${user_id_ds_key}:`, err);
                return void resp_func(err);
              }
              provider_id_data = {
                created: Date.now(),
                user_id,
              };
              // Then, save the forward mapping, and return it to the caller
              self.setData(provider_id_ds_key, provider_id_data, (err) => {
                delete self.recently_allocated_ids[user_id]; // future callers will find the reverse entry in the DB
                resp_func(err, provider_id_data);
              });
            });
          });
        }
        tryAlloc(max_tries);
      });
    });
  }

  /**
   * Retrieves multiple user ids for which the given provider ids are mapped to.
   * The result will only contain the user ids that exist for the given provider ids.
   * @param {HandlerSource} source Source
   * @param {object} data Input data that must contain: a provider property identifying the provider;
   * and a provider_ids property with an array of the ids for the given provider.
   * @param {function} resp_func Callback function that receives an error if any occurred,
   * and the resulting object, which will contain mappings from the original provider ids
   * to the corresponding mapped user ids for the ones that exist.
   * @returns {undefined}
   */
  handleIdMapGetMultipleIds(
    source: HandlerSource,
    data: { provider: string; provider_ids: string[]; get_deleted?: boolean },
    resp_func: ErrorCallback<Record<string, string>>,
  ): void {
    let { provider, provider_ids, get_deleted } = data;

    this.debugSrc(source, `Getting multiple id mappings for provider ${provider}`);

    let results: Record<string, string> = { };

    if (provider_ids.length <= 0) {
      return void resp_func(null, results);
    }

    let self = this;
    const providerIdGetterMultiple = get_deleted ? self.getDataMultiple : self.getNonDeletedProviderIdMultiple;

    function makeQuery(start: number): void {
      let provider_id_ds_key = getProviderIdMapStoreKey(provider, provider_ids[start]);
      self.getData<ProviderIdData>(provider_id_ds_key, (err, provider_id_data) => {
        if (err) {
          self.errorSrc(source, `Error getting ${provider_id_ds_key}:`, err);
          return void resp_func(err);
        }

        if (provider_id_data?.user_id && (
          get_deleted ? true : !provider_id_data.deleted
        )) {
          results[provider_ids[start]] = provider_id_data.user_id;
        }

        start++;
        if (start < provider_ids.length) {
          makeQuery(start);
        } else {
          return void resp_func(null, results);
        }
      });
    }

    function makeQueryMultiple(): void {
      let len = provider_ids.length;
      let provider_ids_ds_keys = new Array(len);
      for (let i = 0; i < len; i++) {
        provider_ids_ds_keys[i] = getProviderIdMapStoreKey(provider, provider_ids[i]);
      }

      providerIdGetterMultiple(provider_ids_ds_keys, (err, provider_ids_data) => {
        if (err) {
          self.errorSrc(source, `Error getting ${len} ids for provider ${provider}:`, err);
          return void resp_func(err);
        }

        if (provider_ids_data) {
          for (let i = 0; i < len; i++) {
            let provider_id_data = provider_ids_data[i];
            if (provider_id_data && provider_id_data.user_id) {
              results[provider_ids[i]] = provider_id_data.user_id;
            }
          }
        }

        return void resp_func(null, results);
      });
    }

    // TODO: getMultipleAsync is not yet implemented in the data store.
    // Once it is, we can remove this check and delete the makeQuery function.
    if (self.channel_server.ds_store_meta.getMultipleAsync) {
      makeQueryMultiple();
    } else {
      makeQuery(0);
    }
  }

  /**
   * Associates a provider id to a user id.
   * @param {HandlerSource} source Source
   * @param {object} data Input data that must contain: a provider property identifying the provider;
   * a provider_id property with the id for the given provider;
   * and a user_id property corresponding to the user id to associate.
   * @param {function} resp_func Callback function that receives an error if any occurred,
   * and the result of the operation, which will be true in case of success.
   * @returns {undefined}
   */
  handleIdMapAssociateIds(
    source: HandlerSource,
    data: { provider: string; provider_id: string; user_id: string; set_deleted?: boolean },
    resp_func: ErrorCallback<boolean>,
  ): void {
    let { provider, provider_id, user_id, set_deleted } = data;
    let provider_id_ds_key = getProviderIdMapStoreKey(provider, provider_id);
    this.debugSrc(source,
      `Associating id mapping for ${provider}/${provider_id} to ${user_id} in ${provider_id_ds_key}`);

    // Ensure no concurrent access regarding the given provider id
    this.aquireResourceAsync(provider_id_ds_key, (release_callback: () => void) => {
      let orig_resp_func = resp_func;
      resp_func = (err, result) => {
        release_callback();
        orig_resp_func(err, result);
      };

      // Check if we already have an ID saved
      this.getData<ProviderIdData>(provider_id_ds_key, (err, provider_id_data) => {
        if (err) {
          this.errorSrc(source, `Error getting ${provider_id_ds_key}:`, err);
          return void resp_func(err);
        }
        if (provider_id_data?.user_id && (
          set_deleted ? true : !provider_id_data.deleted
        )) {
          if (provider_id_data.user_id === user_id) {
            return void resp_func(null, true);
          } else {
            this.warnSrc(source,
              `Provider id ${provider}/${provider_id} already has a user id ${provider_id_data.user_id} ` +
              `different than ${user_id}`);
            return void resp_func('This FRVR Account is already associated with a ' +
              `different Worlds FRVR ID (${provider_id_data.user_id})`);
          }
        }

        let new_provider_id_data: ProviderIdData = {
          created: Date.now(),
          user_id,
        };
        if (set_deleted) {
          new_provider_id_data.deleted = new_provider_id_data.created;
        }

        // Get the user
        let user_id_ds_key = getUserIdMapStoreKey(user_id);
        this.getData<UserIdData>(user_id_ds_key, (err, user_id_data) => {
          if (err) {
            this.errorSrc(source, `Error getting ${user_id_ds_key}:`, err);
            return void resp_func(err);
          }

          if (user_id_data) {
            // The user exists but the provider mapping doesn't, so we still need to save it
            return void this.setData<ProviderIdData>(provider_id_ds_key, new_provider_id_data, (err) => {
              if (err) {
                this.errorSrc(source, `Error setting ${provider_id_ds_key}:`, err);
                return void resp_func(err);
              }
              return void resp_func(null, true);
            });
          }

          user_id_data = {
            created: Date.now(),
          };

          this.setData(user_id_ds_key, user_id_data, (err) => {
            if (err) { // should never happen
              this.errorSrc(source, `Error setting ${user_id_ds_key}:`, err);
              return void resp_func(err);
            }

            this.setData(provider_id_ds_key, new_provider_id_data, (err) => {
              if (err) {
                this.errorSrc(source, `Error setting ${provider_id_ds_key}:`, err);
                return void resp_func(err);
              }
              return void resp_func(null, true);
            });
          });
        });
      });
    });
  }

  /**
   * Associate a new provider id to a user id and delete current one.
   * @param {HandlerSource} source Source
   * @param {object} data Input data that must contain:
   * a current_provider property identifying the provider to be deleted;
   * a current_provider_id property identifying the id of the provider to be deleted;
   * a provider property identifying the provider;
   * a provider_id property with the id for the given provider;
   * and a user_id property corresponding to the user id to associate.
   * @param {function} resp_func Callback function that receives an error if any occurred,
   * and the result of the operation, which will be true in case of success.
   * @returns {undefined}
   */
  handleIdMapReplaceId(
    source: HandlerSource,
    data: {
      current_provider: string;
      current_provider_id: string;
      provider: string;
      provider_id: string;
      user_id: string;
    },
    resp_func: ErrorCallback<boolean>,
  ): void {
    const { provider, provider_id, user_id, current_provider, current_provider_id } = data;

    this.handleIdMapAssociateIds(source, { provider, provider_id, user_id }, (association_err) => {
      if (association_err) {
        return void resp_func(association_err);
      }
      const id_map_key = getProviderIdMapStoreKey(current_provider, current_provider_id);
      this.getNonDeletedProviderId(id_map_key, (get_err, id_map) => {
        if (get_err) {
          return void resp_func(get_err);
        }
        this.setData(id_map_key, {
          ...id_map,
          deleted: Date.now()
        }, (set_err) => {
          if (set_err) {
            this.errorSrc(source, `Error setting delete for ${id_map_key}:`, set_err);
            return void resp_func(set_err);
          }
          return void resp_func(null, true);
        });
      });
    });
  }
}
IdMapperWorker.prototype.require_login = false;
IdMapperWorker.prototype.auto_destroy = false;

export function idmapperWorkerInit(channel_server: ChannelServer): void {
  channel_server.registerChannelWorker('idmapper', IdMapperWorker, {
    autocreate: true,
    subid_regex: /^idmapper$/,
    handlers: {
      id_map_get_id: IdMapperWorker.prototype.handleIdMapGetId,
      id_map_get_create_id: IdMapperWorker.prototype.handleIdMapGetCreateId,
      id_map_associate_ids: IdMapperWorker.prototype.handleIdMapAssociateIds,
      id_map_get_multiple_ids: IdMapperWorker.prototype.handleIdMapGetMultipleIds,
      id_map_replace_id: IdMapperWorker.prototype.handleIdMapReplaceId,
    },
  });
}
