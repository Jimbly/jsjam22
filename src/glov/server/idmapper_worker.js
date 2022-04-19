const { ChannelWorker } = require('./channel_worker.js');

// General purpose worker(s) for handling global state

const id_characters = '0123456789';
function randNumericId(len) {
  const chars_length = id_characters.length;
  let r = [];
  for (let i = 0; i < len; i++) {
    let index = Math.floor(Math.random() * chars_length);
    r.push(id_characters[index]);
  }
  return r.join('');
}

class IdMapperWorker extends ChannelWorker {
  constructor(channel_server, channel_id, channel_data) {
    super(channel_server, channel_id, channel_data);

    this.recently_allocated_ids = {};
  }

  static getProviderIdMapStoreKey(provider, provider_id) {
    return `idmaps_providers/${provider}.${provider_id}`;
  }

  static getUserIdMapStoreKey(user_id) {
    return `idmaps_users/${user_id}`;
  }

  /**
   * Retrieves a user id for which a given provider id is mapped to.
   * @param {*} source Source
   * @param {object} data Input data that must contain: a provider property identifying the provider;
   * a provider_id property with the id for the given provider.
   * @param {function} resp_func Callback function that receives an error if any occurred,
   * and the resulting object containing a user_id property with the corresponding user id, if such exists.
   * @returns {undefined}
   */
  handleIdMapGetId(source, data, resp_func) {
    let { provider, provider_id } = data;
    let provider_id_ds_key = IdMapperWorker.getProviderIdMapStoreKey(provider, provider_id);
    this.debugSrc(source, `Getting id mapping for ${provider}/${provider_id} in ${provider_id_ds_key}`);
    return void this.channel_server.ds_store_meta.getAsync(provider_id_ds_key, null, resp_func);
  }

  /**
   * Retrieves a user id for which a given provider id is mapped to, creating a new user id if none exists.
   * @param {*} source Source
   * @param {object} data Input data that must contain: a provider property identifying the provider;
   * a provider_id property with the id for the given provider.
   * @param {function} resp_func Callback function that receives an error if any occurred,
   * and the resulting object containing a user_id property with the corresponding user id.
   * @returns {undefined}
   */
  handleIdMapGetCreateId(source, data, resp_func) {
    let { provider, provider_id } = data;
    let provider_id_ds_key = IdMapperWorker.getProviderIdMapStoreKey(provider, provider_id);
    this.debugSrc(source, `Getting or creating id mapping for ${provider}/${provider_id} in ${provider_id_ds_key}`);

    // Ensure no concurrent access regarding the given provider id
    this.aquireResourceAsync(provider_id_ds_key, (release_callback) => {
      let orig_resp_func = resp_func;
      resp_func = (err, result) => {
        release_callback();
        orig_resp_func(err, result);
      };

      // Check if we already have an ID saved
      this.channel_server.ds_store_meta.getAsync(provider_id_ds_key, null, (err, provider_id_data) => {
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
        function tryAlloc(tries) {
          let user_id;
          do {
            user_id = randNumericId(len);
          } while (self.recently_allocated_ids[user_id]);
          // Keep an in-memory map of allocations currently in-flight, in case of momentary random collision
          self.recently_allocated_ids[user_id] = true;

          // Ensure no one else is mapped to this ID already
          let user_id_ds_key = IdMapperWorker.getUserIdMapStoreKey(user_id);
          self.channel_server.ds_store_meta.getAsync(user_id_ds_key, null, (err, user_id_data) => {
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
            self.channel_server.ds_store_meta.setAsync(user_id_ds_key, user_id_data, (err) => {
              if (err) { // should never happen
                self.errorSrc(source, `Error setting ${user_id_ds_key}:`, err);
                return void resp_func(err);
              }
              provider_id_data = {
                created: Date.now(),
                user_id,
              };
              // Then, save the forward mapping, and return it to the caller
              self.channel_server.ds_store_meta.setAsync(provider_id_ds_key, provider_id_data, (err) => {
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
   * @param {*} source Source
   * @param {object} data Input data that must contain: a provider property identifying the provider;
   * and a provider_ids property with an array of the ids for the given provider.
   * @param {function} resp_func Callback function that receives an error if any occurred,
   * and the resulting object, which will contain mappings from the original provider ids
   * to the corresponding mapped user ids for the ones that exist.
   * @returns {undefined}
   */
  handleIdMapGetMultipleIds(source, data, resp_func) {
    let { provider, provider_ids } = data;
    this.debugSrc(source, `Getting multiple id mappings for provider ${provider}`);

    let results = { };

    if (provider_ids.length <= 0) {
      return void resp_func(null, results);
    }

    let self = this;

    function makeQuery(start) {
      let provider_id_ds_key = IdMapperWorker.getProviderIdMapStoreKey(provider, provider_ids[start]);
      self.channel_server.ds_store_meta.getAsync(provider_id_ds_key, null, (err, provider_id_data) => {
        if (err) {
          self.errorSrc(source, `Error getting ${provider_id_ds_key}:`, err);
          return void resp_func(err);
        }

        if (provider_id_data?.user_id) {
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

    function makeQueryMultiple() {
      let len = provider_ids.length;
      let provider_ids_ds_keys = new Array(len);
      for (let i = 0; i < len; i++) {
        provider_ids_ds_keys[i] = IdMapperWorker.getProviderIdMapStoreKey(provider, provider_ids[i]);
      }

      self.channel_server.ds_store_meta.getMultipleAsync(provider_ids_ds_keys, (err, provider_ids_data) => {
        if (err) {
          self.errorSrc(source, `Error getting ${len} ids for provider ${provider}:`, err);
          return void resp_func(err);
        }

        for (let i = 0; i < len; i++) {
          let provider_id_data = provider_ids_data[i];
          if (provider_id_data && provider_id_data.user_id) {
            results[provider_ids[i]] = provider_id_data.user_id;
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
   * @param {*} source Source
   * @param {object} data Input data that must contain: a provider property identifying the provider;
   * a provider_id property with the id for the given provider;
   * and a user_id property corresponding to the user id to associate.
   * @param {function} resp_func Callback function that receives an error if any occurred,
   * and the result of the operation, which will be true in case of success.
   * @returns {undefined}
   */
  handleIdMapAssociateIds(source, data, resp_func) {
    let { provider, provider_id, user_id } = data;
    let provider_id_ds_key = IdMapperWorker.getProviderIdMapStoreKey(provider, provider_id);
    this.debugSrc(source,
      `Associating id mapping for ${provider}/${provider_id} to ${user_id} in ${provider_id_ds_key}`);

    // Ensure no concurrent access regarding the given provider id
    this.aquireResourceAsync(provider_id_ds_key, (release_callback) => {
      let orig_resp_func = resp_func;
      resp_func = (err, result) => {
        release_callback();
        orig_resp_func(err, result);
      };

      // Check if we already have an ID saved
      this.channel_server.ds_store_meta.getAsync(provider_id_ds_key, null, (err, provider_id_data) => {
        if (err) {
          this.errorSrc(source, `Error setting ${provider_id_ds_key}:`, err);
          return void resp_func(err);
        }
        if (provider_id_data?.user_id) {
          if (provider_id_data.user_id === user_id) {
            return void resp_func(null, true);
          } else {
            this.warnSrc(source,
              `Provider id  ${provider}/${provider_id} already has a user id ${provider_id_data.user_id} ` +
              `different than ${user_id}`);
            return void resp_func('Provider id already has a different user id');
          }
        }

        provider_id_data = {
          created: Date.now(),
          user_id,
        };

        // Get the user
        let user_id_ds_key = IdMapperWorker.getUserIdMapStoreKey(user_id);
        this.channel_server.ds_store_meta.getAsync(user_id_ds_key, null, (err, user_id_data) => {
          if (err) {
            this.errorSrc(source, `Error getting ${user_id_ds_key}:`, err);
            return void resp_func(err);
          }

          if (user_id_data) {
            // The user exists but the provider mapping doesn't, so we still need to save it
            return void this.channel_server.ds_store_meta.setAsync(provider_id_ds_key, provider_id_data, (err) => {
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

          this.channel_server.ds_store_meta.setAsync(user_id_ds_key, user_id_data, (err) => {
            if (err) { // should never happen
              this.errorSrc(source, `Error setting ${user_id_ds_key}:`, err);
              return void resp_func(err);
            }

            this.channel_server.ds_store_meta.setAsync(provider_id_ds_key, provider_id_data, (err) => {
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
}
IdMapperWorker.prototype.require_login = false;
IdMapperWorker.prototype.auto_destroy = true;

export function idmapperWorkerInit(channel_server) {
  channel_server.registerChannelWorker('idmapper', IdMapperWorker, {
    autocreate: true,
    subid_regex: /^idmapper$/,
    handlers: {
      id_map_get_id: IdMapperWorker.prototype.handleIdMapGetId,
      id_map_get_create_id: IdMapperWorker.prototype.handleIdMapGetCreateId,
      id_map_associate_ids: IdMapperWorker.prototype.handleIdMapAssociateIds,
      id_map_get_multiple_ids: IdMapperWorker.prototype.handleIdMapGetMultipleIds,
    },
  });
}
