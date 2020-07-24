"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true,
});
exports.default = void 0;

var _uid = _interopRequireDefault(require("uid"));

var _moment = _interopRequireDefault(require("moment"));

var _eventemitter = _interopRequireDefault(require("eventemitter3"));

var _dotenv = require("dotenv");

var _RentalProviders = require("./RentalProviders");

var _RentalStrategies = require("./RentalStrategies");

var _AutoRenter = _interopRequireDefault(require("./AutoRenter"));

var _constants = require("./constants");

const fetch = require("node-fetch");

function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : { default: obj };
}

function ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);
  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly)
      symbols = symbols.filter(function (sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      });
    keys.push.apply(keys, symbols);
  }
  return keys;
}

function _objectSpread(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};
    if (i % 2) {
      ownKeys(Object(source), true).forEach(function (key) {
        _defineProperty(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys(Object(source)).forEach(function (key) {
        Object.defineProperty(
          target,
          key,
          Object.getOwnPropertyDescriptor(source, key)
        );
      });
    }
  }
  return target;
}

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    obj[key] = value;
  }
  return obj;
}

(0, _dotenv.config)();
const SUPPORTED_RENTAL_PROVIDERS = [
  _RentalProviders.MRRProvider,
  _RentalProviders.NiceHashProvider,
];
const SUPPORTED_RENTAL_STRATEGIES = [
  _RentalStrategies.SpartanSenseStrategy,
  _RentalStrategies.ManualRentStrategy,
  _RentalStrategies.SpotRentalStrategy,
];
let localStorage;

if (
  typeof window === "undefined" ||
  typeof window.localStorage === "undefined"
) {
  if (typeof localStorage === "undefined") {
    var LocalStorage = require("node-localstorage").LocalStorage;

    localStorage = new LocalStorage("./localStorage");
  }
} else {
  localStorage = window.localStorage;
}

let waitFn = async (time) => {
  setTimeout(() => {
    return;
  }, time || 1000);
};
/**
 * Rent hashrate based on a set of circumstances
 */

class SpartanBot {
  /**
   * Create a new SpartanBot
   * @param  {Object} settings - The settings for the SpartanBot node
   * @param {Boolean} [settings.memory=false] - Should SpartanBot only run in Memory and not save anything to disk
   * @param {string} [settings.mnemonic] - Pass in a mnemonic to have the SpartanBot load your personal wallet
   * @return {SpartanBot}
   */
  constructor(settings) {
    this.settings = settings || {};
    this.self = this;
    this.rental_providers = [];
    this.rental_strategies = {};
    this.pools = [];
    this.poolProfiles = [];
    this.receipts = [];
    this.emitter = new _eventemitter.default();
    this.setupListeners(); // Try to load state from LocalStorage if we are not memory only

    if (!this.settings.memory) {
      // Save the settings to the localstorage
      this.serialize();
    }
  }
  /**
   * Setup event listeners for rental activity
   */

  setupListeners() {
    this.emitter.on(
      _constants.RentalFunctionFinish,
      this.onRentalFnFinish.bind(this)
    );
    this.emitter.on("error", (type, error) => {
      console.error(
        "There was an error in the ".concat(type, " event: "),
        error
      );
    });
    this.onRentalSuccess();
    this.onRentalWarning();
    this.onRentalError();
  }

  onRentalSuccess() {
    let onSuccess =
      arguments.length > 0 && arguments[0] !== undefined
        ? arguments[0]
        : (rental_info) => {
            console.log("Rental Success", rental_info);
          };
    this.emitter.off(_constants.RENTAL_SUCCESS);
    this.emitter.on(_constants.RENTAL_SUCCESS, onSuccess);
  }

  onRentalWarning() {
    let onWarning =
      arguments.length > 0 && arguments[0] !== undefined
        ? arguments[0]
        : (rental_info) => {
            console.log("Rental Warning", rental_info);
          };
    this.emitter.off(_constants.RENTAL_WARNING);
    this.emitter.on(_constants.RENTAL_WARNING, onWarning);
  }

  onRentalError() {
    let onError =
      arguments.length > 0 && arguments[0] !== undefined
        ? arguments[0]
        : (rental_info) => {
            console.log("Rental Error", rental_info);
          };
    this.emitter.off(_constants.RENTAL_ERROR);
    this.emitter.on(_constants.RENTAL_ERROR, onError);
  }

  onRentalFnFinish(rental_info) {
    console.log("rental function finished... saving rental_info");
    this.saveReceipt(rental_info);

    switch (rental_info.status) {
      case _constants.NORMAL:
        this.emitter.emit(_constants.RENTAL_SUCCESS, rental_info);
        break;

      case _constants.WARNING:
        this.emitter.emit(_constants.RENTAL_WARNING, rental_info);
        break;

      case _constants.ERROR:
        this.emitter.emit(_constants.RENTAL_ERROR, rental_info);
        break;

      default:
        console.log("Rental info not of expected type!", rental_info);
    }
  }
  /**
   * Setup a new Rental Strategy to auto-rent machines with.
   * @return {Boolean} Returns `true` if setup was successful
   */

  setupRentalStrategy(settings) {
    let rental_strategy;

    for (let strategy of SUPPORTED_RENTAL_STRATEGIES) {
      if (strategy.getType() === settings.type) {
        rental_strategy = strategy;
      }
    }

    if (!rental_strategy)
      throw new Error("No Strategy match found for `settings.type`!");
    let strat = new rental_strategy(settings); // spartan.rent() = this.rent.bind(this)

    this.rental_strategies[strat.getInternalType()] = strat;
    strat.onRentalTrigger(this.rent.bind(this)); // Runs onRentalTrigger in GenericStrategy.js

    this.rental_strategies[strat.getInternalType()] = strat;
    this.serialize();
  }
  /**
   * Get all rental strategies or by individual type
   * @param {String} [type] - 'ManualRent', 'SpotRental', 'SpartanSense', 'TradeBot
   * @returns {Object} - If no type is given, will return all strategies
   */

  getRentalStrategies(type) {
    if (type) return this.rental_strategies[type];
    return this.rental_strategies;
  }
  /**
   * Fire off a manual rent event
   * @param  {Number} hashrate - The hashrate you wish to rent (in MegaHash)
   * @param  {Number} duration - The number of seconds that you wish to rent the miners for
   * @param  {Function} [rentSelector] - Pass in a function that returns a Promise to offer rent options to user
   */

  manualRent(options, rentSelector) {
    if (!this.getRentalStrategies(_constants.ManualRent))
      this.setupRentalStrategy({
        type: _constants.ManualRent,
      });
    let strat = this.getRentalStrategies(_constants.ManualRent);
    strat.manualRent(options, rentSelector); // Hits manualRent in ManualRentStrategy.js
  }
  /**
   * Fire off an event to start calculating spot profitability
   * @param {function} rentSelector - an async function that takes in two parameters, `preprocess_rent` and `options`. Use to select which rent option to go with.
   * @param {boolean} [fullnode=false] - specify whether you want to spawn a full node to read from
   */

  spotRental(rentSelector) {
    let fullnode =
      arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
    if (!this.getRentalStrategies(_constants.SpotRental))
      this.setupRentalStrategy({
        type: _constants.SpotRental,
      });
    let strat = this.getRentalStrategies(_constants.SpotRental);
    strat.spotRental(rentSelector, fullnode, this);
  }
  /**
   * Rent
   * @param  {Number} hashrate - The hashrate you wish to rent (in MegaHash)
   * @param  {Number} duration - The number of seconds that you wish to rent the miners for
   * @param  {Function} [rentSelector] - Pass in a function that returns a Promise to offer rent options to user
   * @param  {Object} self - a reference to 'this', the SpartanBot class (needed because the reference is lost when using event emitters)
   * @private
   * @return {Promise<Object>} Returns a Promise that will resolve to an Object that contains information about the rental request
   */
  // Hit from ManualRentStrategy.js out of the this.emitter.emit(_constants.TriggerRental, hashrate, duration, rentSelector);

  rent(options, rentSelector) {
    this.autorenter = new _AutoRenter.default({
      rental_providers: this.rental_providers,
    });
    this.autorenter
      .rent({
        options,
        rentSelector,
      })
      .then((rental_info) => {
        this.emitter.emit(_constants.RentalFunctionFinish, rental_info);
      })
      .catch((err) => {
        let rental_info = {
          status: _constants.ERROR,
          message: "Unable to rent using SpartanBot!",
          error: err,
        };
        this.emitter.emit(_constants.RentalFunctionFinish, rental_info);
      });
  }
  /**
   * Setup a new Rental Provider for use
   * @param {Object} settings - The settings for the Rental Provider
   * @param {String} settings.type - The "type" of the rental provider. Currently only accepts "MiningRigRentals".
   * @param {String} settings.api_key - The API Key for the Rental Provider
   * @param {String|Number} [settings.api_id] - The API ID from the Rental Provider
   * @param {String} [settings.api_secret] - The API Secret for the Rental Provider
   * @param {String} settings.name - Alias/arbitrary name for the provider
   * @return {Promise<Object>} Returns a promise that will resolve after the rental provider has been setup
   */

  async setupRentalProvider(settings) {
    // Force settings to be passed
    if (!settings.type) {
      return {
        success: false,
        message: "settings.type is required!",
      };
    }

    if (!settings.api_key) {
      return {
        success: false,
        message: "settings.api_key is required!",
      };
    }

    if (!settings.api_secret && !settings.api_id) {
      return {
        success: false,
        message: "settings.api_secret or settings.api_id is required!",
      };
    } // Match to a supported provider (if possible)

    let provider_match;

    for (let provider of SUPPORTED_RENTAL_PROVIDERS) {
      if (provider.getType() === settings.type) {
        provider_match = provider;
      }
    } // Check if we didn't match to a provider

    if (!provider_match) {
      return {
        success: false,
        message: "No Provider found that matches settings.type",
      };
    } // Create the new provider

    let new_provider = new provider_match(settings); // Test to make sure the API keys work

    try {
      let authorized = await new_provider.testAuthorization();

      if (!authorized) {
        return {
          success: false,
          message: "Provider Authorization Failed",
        };
      }
    } catch (e) {
      throw new Error("Unable to check Provider Authorization!\n" + e);
    }

    if (settings.activePool) {
      new_provider.setActivePool(settings.activePool);
    }

    if (settings.activePoolProfile) {
      new_provider.setActivePoolProfile(settings.activePoolProfile);
    }

    if (settings.name) {
      new_provider.setName(settings.name);
    }

    let pools = [];
    let poolProfiles = [];

    if (settings.type === "MiningRigRentals") {
      process.env.MRR_API_KEY = settings.api_key || settings.key;
      process.env.MRR_API_SECRET = settings.api_secret || settings.id;
      let profiles;

      try {
        let res = await new_provider.getPoolProfiles();

        if (res.success) {
          profiles = res.data;
        }
      } catch (err) {
        profiles = "Could not fetch pools: \n ".concat(err);
      }

      let ids = [];

      for (let profile of profiles) {
        ids.push({
          id: profile.id,
          name: profile.name,
        });
      }

      poolProfiles = ids.slice(0, ids.length);
      new_provider.setPoolProfiles(ids);

      try {
        pools = await new_provider.getPools();
      } catch (err) {
        pools = [
          {
            success: false,
            message: "pools not found",
            err,
          },
        ];
      }

      new_provider.setPools(pools); //if no active pool profile set, set it to the first one retrieved from the api

      if (!new_provider.returnActivePoolProfile()) {
        if (ids.length !== 0) new_provider.setActivePoolProfile(ids[0].id);
      }
    } else if (settings.type === "NiceHash") {
      process.env.NICEHASH_API_KEY = settings.api_key || settings.key;
      process.env.NICEHASH_API_ID = settings.api_id || settings.id;

      try {
        let res = await new_provider.getPools();

        if (res.errors) {
          return (pools = {
            success: false,
            message:
              "pools not found. If error, check NiceHash credentials or api url",
            error: res.errors,
          });
        } else {
          pools = res;
        }
      } catch (e) {
        return (pools = [
          {
            success: false,
            message: "pools not found",
            e,
          },
        ]);
      }

      new_provider.setPools(pools);
    }

    this.rental_providers.push(new_provider); // Save new Provider

    this.serialize(); // Return info to the user

    return {
      success: true,
      message: "Successfully Setup Rental Provider",
      type: settings.type,
      name: settings.name,
      uid: new_provider.uid,
      pools,
      poolProfiles,
      provider: new_provider,
      spartanbot: this,
    };
  }
  /**
   * Get all of the Supported Rental Providers that you can Setup
   * @return {Array.<String>} Returns an array containing all the supported providers "type" strings
   */

  getSupportedRentalProviders() {
    let supported_provider_types = []; // Itterate through all supported rental providers

    for (let provider of SUPPORTED_RENTAL_PROVIDERS) {
      // Grab the type of the provider
      let provider_type = provider.getType(); // Check if we have already added the provider to the array

      if (supported_provider_types.indexOf(provider_type) === -1) {
        // If not, add it to the array
        supported_provider_types.push(provider_type);
      }
    } // Return the Array of all Supported Rental Provider types

    return supported_provider_types;
  }
  /**
   * Get all Rental Providers from SpartanBot
   * @return {Array.<MRRProvider>} Returns an array containing all the available providers
   */

  getRentalProviders() {
    return this.rental_providers;
  }
  /**
   * Delete a Rental Provider from SpartanBot
   * @param  {String} uid - The uid of the Rental Provider to remove (can be acquired by running `.getUID()` on a RentalProvider)
   * @return {Boolean} Returns true upon success
   */

  deleteRentalProvider(uid) {
    if (!uid)
      throw new Error(
        "You must include the UID of the Provider you want to remove"
      );
    let new_provider_array = [];

    for (let i = 0; i < this.rental_providers.length; i++) {
      if (this.rental_providers[i].getUID() !== uid) {
        new_provider_array.push(this.rental_providers[i]);
      }
    }

    this.rental_providers = new_provider_array;
    this.serialize();
    return true;
  }
  /**
   * Get all setting back from SpartanBot
   * @return {Object} Returns an object containing all the available settings
   */

  getSettings() {
    return JSON.parse(JSON.stringify(this.settings));
  }
  /**
   * Get a setting back from SpartanBot
   * @param  {String} key - The setting key you wish to get the value of
   * @return {Object|String|Array.<Object>} Returns the value of the requested setting
   */

  getSetting(key) {
    return this.settings[key];
  }
  /**
   * Set a setting
   * @param {String} key - What setting you wish to set
   * @param {*} value - The value you wish to set the setting to
   */

  setSetting(key, value) {
    if (key !== undefined && value !== undefined) this.settings[key] = value; // Save the latest

    this.serialize();
    return true;
  }
  /**
   * Get the balance of the internal wallet
   * @param  {Boolean} [fiat_value=false] - `true` if the balance should returned be in Fiat, `false` if the balance should be returned in the regular coin values
   * @return {Promise}
   */

  async getWalletBalance(fiat_value) {
    if (!this.wallet)
      return {
        success: false,
        info: "NO_WALLET",
        message:
          "No wallet was found in SpartanBot, may be running in memory mode",
      };
    if (fiat_value) return await this.wallet.wallet.getFiatBalances(["flo"]);
    else return await this.wallet.wallet.getCoinBalances(["flo"]);
  }
  /**
   * Withdraw funds from your internal wallet
   * @param {String} options - passing of new address connecting to the HDMW sendPayment
   */

  async withdrawFromWallet(options) {
    if (!this.wallet)
      return {
        success: false,
        info: "NO_WALLET",
        message:
          "No wallet was found in SpartanBot, may be running in memory mode",
      };
    if (options) return await this.wallet.wallet.sendPayment(options);
  }
  /**
   * Get pools
   * @param {Array.<number>} [ids] - an array of pool ids
   * @return {Array.<Object>} pools
   */

  async getPools(ids) {
    if (this.getRentalProviders().length === 0) {
      throw new Error("No rental providers. Cannot get pools.");
    }

    if (typeof ids === "number" && !Array.isArray(ids)) {
      return await this.getPool(ids);
    } else {
      let poolIDs = [];
      let pools = [];

      for (let provider of this.getRentalProviders()) {
        let tmpPools = [];

        try {
          tmpPools = await provider.getPools(ids);
        } catch (err) {
          throw new Error("Failed to get pools: ".concat(err));
        }

        for (let tmp of tmpPools) {
          if (!poolIDs.includes(tmp.id)) {
            poolIDs.push(tmp.id);
            pools.push(tmp);
          }
        }
      }

      return pools;
    }
  }
  /**
   * Get pool by id
   * @param {string|number} id - ID of the pool you want to fetch
   * @return {Object} pool
   */

  async getPool(id) {
    if (!(typeof id === "number" || typeof id === "string")) {
      throw new Error("Cannot get pool: id must be of type number or string");
    }

    let pools = [];
    let poolIDs = [];

    for (let provider of this.getRentalProviders()) {
      let tmpPool;

      try {
        tmpPool = await provider.getPool(id);
      } catch (err) {
        throw new Error("Failed to get pool: ".concat(err));
      }

      if (!poolIDs.includes(tmpPool.id)) {
        poolIDs.push(tmpPool.id);
        pools.push(tmpPool);
      }
    }

    return pools;
  }
  /**
   * Creates a pool that will be added to all providers
   * @param {Object} options
   * @param {string} options.algo - Algorithm ('scrypt', 'x11', etc)
   * @param {string} options.id - unique id for each pool (for spartanbot only)
   * @param {string} options.host - Pool host, the part after stratum+tcp://
   * @param {number} options.port - Pool port, the part after the : in most pool host strings
   * @param {string} options.user - Your workname
   * @param {string} [options.pass='x'] - Worker password
   * @param {string|number} [options.location=0] - NiceHash var only: 0 for Europe (NiceHash), 1 for USA (WestHash) ;
   * @param {string} options.name - Name to identify the pool with
   * @param {number} options.priority - MRR var only: 0-4
   * @param {string} [options.notes] - MRR var only: Additional notes to help identify the pool for you
   * @async
   * @return {Promise<Number>} - the local pool id generated for the pools
   */

  async createPool(options) {
    options.id = (0, _uid.default)();

    for (let p of this.getRentalProviders()) {
      try {
        await p.createPool(options);
      } catch (err) {
        throw new Error("Failed to create pool: ".concat(err));
      }
    }

    return options.id;
  }
  /**
   * Delete a pool
   * @param {(number|string)} id - Pool id
   * @returns {Promise<*>}
   */

  async deletePool(id) {
    let poolDelete = [];

    for (let p of this.getRentalProviders()) {
      //p.name works for returnPools(p.name)
      let pools = p.returnPools(p.name);

      for (let pool of pools) {
        if (pool.id === id || pool.mrrID === id) {
          try {
            poolDelete.push(await p.deletePool(id));
          } catch (err) {
            throw new Error(err);
          }
        }
      }
    }

    for (let i = 0; i < poolDelete.length; i++) {
      if (!poolDelete[i].success) {
        return poolDelete[i];
      }
    }

    return {
      success: true,
      id,
      message: "Deleted",
    };
  }
  /**
   * Update a pool
   * @param {(number|Array.<number>)} poolIDs - IDs of the pools you wish to update
   * @param {string|number} id - pool id
   * @param {Object} [options]
   * @param {string} [options.type] - Pool algo, eg: sha256, scrypt, x11, etc
   * @param {string} [options.name] - Name to identify the pool with
   * @param {string} [options.host] - Pool host, the part after stratum+tcp://
   * @param {number} [options.port] - Pool port, the part after the : in most pool host strings
   * @param {string} [options.user] - Your workname
   * @param {string} [options.pass] - Worker password
   * @param {string} [options.notes] - Additional notes to help identify the pool for you
   * @param {string} [options.providerType] - Which rental provider address should be updated
   * @async
   * @returns {Promise<Array.<Object>>}
   */

  async updatePool(id, options) {
    let updatedPools = [];
    let res;

    for (let provider of this.getRentalProviders()) {
      if (provider.name === options.providerType) {
        try {
          res = await provider.updatePool(id, options);
        } catch (err) {
          console.log("Failed to update pool on RentalProvider.js:", err);
          throw new Error(
            "Failed to update pool on RentalProvider.js: ".concat(err)
          );
        }

        let tmpObj = {};
        tmpObj.name = provider.getName();
        tmpObj.providerUID = provider.getUID();
        tmpObj.message = res.data ? res.data : res;
        updatedPools.push(tmpObj);
      }
    }

    return updatedPools;
  }
  /**
   * Set pools to the spartanbot local variable
   */

  _setPools(pools) {
    this.pools = pools;
  }
  /**
   * Gather and Return the pools set in the RentalProvider's local variable, this.pools
   * @param {(string)} providerType - name of provider you wish to return poos for
   * @return {Array.<Object>}
   */

  returnPools(providerType) {
    if (this.getRentalProviders().length === 0) {
      this._setPools([]);

      return this.pools;
    }

    let pools = [];
    let poolIDs = [];

    for (let provider of this.getRentalProviders()) {
      if (providerType === provider.name) {
        let tmpPools = provider.returnPools();

        for (let pool of tmpPools) {
          if (!poolIDs.includes(pool.id)) {
            poolIDs.push(pool.id);
            pools.push(pool);
          }
        }
      }
    }

    this._setPools(pools);

    return pools;
  }
  /**
   * Create a pool profile
   * @param {string} name - Name of the profile
   * @param {string} algo - Algo (x11, scrypt, sha256)
   * @async
   * @returns {Promise<Object>}
   */

  async createPoolProfile(name, algo) {
    let profiles = [];

    for (let p of this.getRentalProviders()) {
      if (p.getInternalType() === "MiningRigRentals") {
        let res;

        try {
          res = await p.createPoolProfile(name, algo);
        } catch (err) {
          throw new Error("Failed to create pool profile: ".concat(err));
        }

        if (res.success) {
          let modifiedProfile = _objectSpread({}, res.data, {
            uid: p.getUID(),
          });

          profiles.push(modifiedProfile);
          p.addPoolProfiles(modifiedProfile);
        }
      }
    }

    this.returnPoolProfiles();
    return profiles;
  }
  /**
   * Delete a pool profile
   * @param id
   * @returns {Promise<Object>}
   */

  async deletePoolProfile(id) {
    if (this.getRentalProviders().length === 0) {
      return {
        success: false,
        message: "No providers",
      };
    }

    for (let p of this.getRentalProviders()) {
      if (p.getInternalType() === "MiningRigRentals") {
        let profiles = p.returnPoolProfiles();

        for (let i in profiles) {
          if (profiles[i].id === id) {
            let res;

            try {
              res = await p.deletePoolProfile(id);
            } catch (err) {
              throw new Error(err);
            }

            if (res.success) {
              p.poolProfiles.splice(i, 1);
            }
          }
        }
      }
    }

    return {
      success: true,
      message: "profile deleted",
    };
  }
  /**
   * Get Pool Profiles for all MRR Providers attached via the MRR API
   * @async
   * @return {Array.<Object>}
   */

  async getPoolProfiles() {
    if (this.getRentalProviders().length === 0) {
      this._setPools = [];
      return [];
    }

    let profiles = [];
    let profileIDs = [];

    for (let provider of this.getRentalProviders()) {
      if (provider.getInternalType() === "MiningRigRentals") {
        let res = await provider.getPoolProfiles();
        let tmpProfiles = [];

        if (res.success) {
          tmpProfiles = res.data;
        }

        for (let profile of tmpProfiles) {
          if (!profileIDs.includes(profile.id)) {
            profileIDs.push(profile.id);
            profiles.push(profile);
          }
        }
      }
    }

    this._setPoolProfiles(profiles);

    return profiles;
  }
  /**
   * Return the pool profiles stored locally for all MRR providers
   * @return {Array.<Object>}
   */

  returnPoolProfiles() {
    if (this.getRentalProviders().length === 0) {
      // this._setPoolProfiles() = []
      // return []
      this._setPoolProfiles([]);

      return [];
    }

    let returnProfiles = [];
    let profileIDs = [];

    for (let provider of this.getRentalProviders()) {
      if (provider.getInternalType() === "MiningRigRentals") {
        let profiles = provider.returnPoolProfiles();

        for (let profile of profiles) {
          if (!profileIDs.includes(profile.id)) {
            profileIDs.push(profile.id);
            returnProfiles.push(profile);
          }
        }
      }
    }

    this._setPoolProfiles(returnProfiles);

    return returnProfiles;
  }
  /**
   * Set pool profiles to local variable
   * @private
   */

  _setPoolProfiles(profiles) {
    this.poolProfiles = profiles;
  }
  /**
   * Save a rental_info/history object to local storage
   * @param {Object} receipt - an object containing information about a rental
   */

  saveReceipt(receipt) {
    receipt.timestamp = (0, _moment.default)().format(
      "dddd, MMMM Do YYYY, h:mm:ss a"
    );
    receipt.unixTimestamp = Date.now();
    receipt.id = (0, _uid.default)();
    this.receipts.push(receipt);
    this.serialize();
  }
  /**
   * Clear Receipts
   */

  clearReceipts() {
    this.receipts = [];
    this.serialize();
  }
  /**
   * Remove Receipt(s)
   */

  removeReceipts(ids) {
    if (!Array.isArray(ids)) {
      ids = [ids];
    }

    for (let id of ids) {
      for (let i = this.receipts.length - 1; i >= 0; i--) {
        if (this.receipts[i].id === id) {
          this.receipts.splice(i, 1);
        }
      }
    }

    let match = false;

    for (let id of ids) {
      for (let i = this.receipts.length - 1; i >= 0; i--) {
        if (this.receipts[i].id === id) {
          match = true;
        }
      }
    }

    if (!match) this.serialize();
    return {
      success: !match,
    };
  }
  /**
   * Get receipts
   */

  returnReceipts() {
    return this.receipts;
  }

  clearStorage() {
    this.rental_providers = [];
    this.rental_strategies = {};
    this.pools = [];
    this.poolProfiles = [];
    this.receipts = [];
    this.emitter = new _eventemitter.default();
    let serialized = {
      rental_providers: [],
      rental_strategies: {},
      settings: {},
      pools: [],
      poolProfiles: [],
      receipts: [],
    };
    if (!this.settings.memory)
      localStorage.setItem("spartanbot-storage", JSON.stringify(serialized));
    return true;
  }
  /**
   * Serialize all information about SpartanBot to LocalStorage (save the current state)
   * @return {Boolean} Returns true if successful
   * @private
   */

  serialize() {
    let serialized = {
      rental_providers: [],
      rental_strategies: {},
    };
    serialized.settings = this.settings; // serialized.oip_account = this.oip_account

    serialized.pools = this.pools;
    serialized.poolProfiles = this.poolProfiles;
    serialized.receipts = this.receipts;

    for (let provider of this.rental_providers)
      serialized.rental_providers.push(provider.serialize());

    for (let strategyType in this.rental_strategies)
      serialized.rental_strategies[strategyType] = this.rental_strategies[
        strategyType
      ].serialize();

    if (!this.settings.memory)
      localStorage.setItem("spartanbot-storage", JSON.stringify(serialized));
  }
  /**
   * Load all serialized (saved) data from LocalStorage
   * @return {Boolean} Returns true on deserialize success
   * @private
   */

  async deserialize() {
    let data_from_storage = {};
    if (localStorage.getItem("spartanbot-storage"))
      data_from_storage = JSON.parse(
        localStorage.getItem("spartanbot-storage")
      );
    if (data_from_storage.settings)
      this.settings = _objectSpread(
        {},
        data_from_storage.settings,
        {},
        this.settings
      );

    if (data_from_storage.pools) {
      this.pools = data_from_storage.pools;
    }

    if (data_from_storage.poolProfiles) {
      this.poolProfiles = data_from_storage.poolProfiles;
    }

    if (data_from_storage.receipts) {
      this.receipts = data_from_storage.receipts;
    }

    if (data_from_storage.rental_providers) {
      for (let provider of data_from_storage.rental_providers) {
        await this.setupRentalProvider(provider);
      }
    }

    if (data_from_storage.rental_strategies) {
      for (let strategyType in data_from_storage.rental_strategies) {
        this.setupRentalStrategy(
          data_from_storage.rental_strategies[strategyType]
        );
      }
    }

    return true;
  }
}

var https = require("https");
const { info } = require("console");

let settingsNiceHash = {
  type: "NiceHash",
  api_key: "07aedc99-de9e-4241-84b1-182ecc256f15",
  api_secret:
    "41eaf5aa-f129-4c20-a4d0-92c153fb04504d6396e8-f7f9-4f72-ba18-254cee217f67",
  api_id: "93bbe4dc-c3f3-4ce9-a6c3-9a7f43739ba5",
  name: "NiceHash",
};
let settingsMRR = {
  type: "MiningRigRentals",
  api_key: "cfbb52e79a2feae33251a82bdfb78e8cb72f8914a5c70dc9a3734083a31d226d",
  api_secret:
    "32d3dcd369e6cbce750c36cc61902f5450cc8ff3bb13f0238557e216f2864100",
  name: "MiningRigRentals",
};
let fixedPrice = {
  limit: "1.2",
  market: "USA",
  algorithm: "KAWPOW",
};

let spartanBot = new SpartanBot();

let rentalProvider = spartanBot
  .setupRentalProvider(settingsNiceHash)
  .then(async (provider) => {
    let test = await provider.provider.getBalance();
    console.log("Balance: ", test);
    let test2 = await provider.provider.getOrders({
      algo: "KAWPOW",
      status: "ACTIVE",
      alive: true,
    });
    console.log("test2: " + test2);

    let summariesKawpow = await provider.provider.getStandardPrice("KAWPOW");
    let PriceRentalStandardKawpow =
      Math.round(
        10 * summariesKawpow.summaries["USA,KAWPOW"].payingPrice * 1e8
      ) / 1e8;

    let summariesScrypt = await provider.provider.getStandardPrice("SCRYPT");
    let PriceRentalStandardScrypt =
      Math.round(
        10000 * summariesScrypt.summaries["USA,SCRYPT"].payingPrice * 1e8
      ) / 1e8;

    let orderBookKawpow = await provider.provider.getOrderBook("kawpow");
    let marketFactorKawpow = orderBookKawpow.stats.USA.marketFactor;
    let marketFactorNameKawpow = orderBookKawpow.stats.USA.displayMarketFactor;

    let orderBookScrypt = await provider.provider.getOrderBook("scrypt");
    let marketFactorScrypt = orderBookScrypt.stats.USA.marketFactor;
    let marketFactorNameScrypt = orderBookScrypt.stats.USA.displayMarketFactor;

    // let orders = await provider.getOrders('KAWPOW')
    // let status = orders.status
    // console.log('orders',orders)
    // let percentslist = [0.0125, 0.015, 0.0175, 0.02];
    // let LoadPercents = await loadPercents()
    //   console.log('LoadPercents:', LoadPercents)

    let UserInput = await userinput();
    console.log("UserInput:", UserInput);

    let RvnNetworkStats = await rvnnetworkstats();
    console.log("RvnNetworkStats:", RvnNetworkStats);
    console.log("my percent of the network is : " + RvnNetworkStats.my_percent);

    // let GetOrders = await getOrders()
    //   console.log('GetOrders:', GetOrders)

    // let MRRRentalMarket = await MRRrentalmarket()
    //   console.log('MRRRentalMarket:', MRRRentalMarket)

    let MiningMarketInfo = await miningmarketinfo();
    console.log("MiningMarketInfo:", MiningMarketInfo);

    let NetworkMiningInfo = await networkmininginfo();
    console.log("NetworkMiningInfo:", NetworkMiningInfo);

    let Exchanges = await exchanges();
    console.log("Exchanges:", Exchanges);

    let Calculations = await calculations();
    console.log("Calculations:", Calculations);

    let Minimums = await minimums(UserInput.token);
    console.log("Minimums:", Minimums);

    let AlwaysMineModeEstimates = await alwaysminemodeestimates();
    console.log("AlwaysMineModeEstimates:", AlwaysMineModeEstimates);

    function userinput() {
      let token = "RVN";
      let tokenAlgo = "KAWPOW";
      let worker = "RD3R7rPseSpp93W2BKwrw9Y2nDHrhkvD4C";

      let NetworkPercent = 0.03;

      let duration = 1.92;
      let margin = 0.01;
      let rentalPercentComplete = 0.081; //replace with function that pulls live data
      let CostOfRentalInBtc = 0.01445584; //replace with function that pulls live data

      return { token, tokenAlgo, worker, NetworkPercent, duration, margin };
    }

    async function rvnnetworkstats() {
      let apiURL =
        "https://main.rvn.explorer.oip.io/api/statistics/pools?date=2020-07-23";
      const response = await fetch(apiURL);
      const data = await response.json();
      let dat1 = data.blocks_by_pool;
      for (let i = 0; i < dat1.length; i++) {
        if (dat1[i].poolName === "2Miners PPLNS") {
          let totals = dat1.slice(0, i + 1);
          let percent_leader = dat1[0].percent_total;
          let my_percent = totals.slice(-1)[0].percent_total;
          let difference = my_percent / percent_leader;
          return { percent_leader, my_percent, difference };
        }
      }
      return null;
    }

    async function miningmarketinfo() {
      let tokenAlgo = UserInput.tokenAlgo;
      let PriceRentalStandard;
      if (/KAWPOW/.test(tokenAlgo)) {
        let orderBookKawpow = await provider.provider.getOrderBook("kawpow");
        let marketFactorKawpow = orderBookKawpow.stats.USA.marketFactor;
        let marketFactorNameKawpow =
          orderBookKawpow.stats.USA.displayMarketFactor;
        let PriceRentalStandard = PriceRentalStandardKawpow;
        let PriceUnits = "BTC per GH/s per Day";
        let orderBook = orderBookKawpow;
        let marketFactor = marketFactorKawpow;
        let marketFactorName = marketFactorNameKawpow;
        return {
          PriceRentalStandard,
          PriceUnits,
          marketFactor,
          marketFactorName,
        };
      } else {
        if (/SCRYPT/.test(tokenAlgo)) {
          let orderBookKawpow = await provider.provider.getOrderBook("scrypt");
          let marketFactorScrypt = orderBookScrypt.stats.USA.marketFactor;
          let marketFactorNameScrypt =
            orderBookScrypt.stats.USA.displayMarketFactor;
          let PriceRentalStandard = PriceRentalStandardScrypt;
          let PriceUnits = "BTC per TH/s per Day";
          let orderBook = orderBookScrypt;
          let marketFactor = marketFactorScrypt;
          let marketFactorName = marketFactorNameScrypt;
          return {
            PriceRentalStandard,
            PriceUnits,
            marketFactor,
            marketFactorName,
          };
        }
      }
    }

    async function networkmininginfo() {
      let token = UserInput.token;

      async function rvnnetworkmininginfo() {
        return await new Promise((resolve, reject) => {
          https
            .get("https://rvn.2miners.com/api/stats", (response) => {
              let body = "";
              response.on("data", (chunk) => {
                body += chunk;
              });
              response.on("end", () => {
                let data = JSON.parse(body);
                if (!data)
                  console.log("Something wrong with the api or syntax");
                let networkhashps = data.nodes[0].networkhashps;

                let marketFactor = MiningMarketInfo.marketFactor;
                let MarketFactorName = MiningMarketInfo.marketFactorName;
                let Networkhashrate =
                  Math.round((networkhashps / marketFactor) * 1e3) / 1e3;

                resolve({ networkhashps, Networkhashrate, MarketFactorName });
              });
            })
            .on("error", (error) => {
              console.log("Error: " + error.message);
              reject("Error: " + error.message);
            });
        });
        // return ({networkhashps,Networkhashrate,MarketFactorName})
      }
      async function flonetworkmininginfo() {
        return await new Promise((resolve, reject) => {
          https
            .get("https://pool.mediciland.com/api/pools", (response) => {
              let body = "";
              response.on("data", (chunk) => {
                body += chunk;
              });
              response.on("end", () => {
                let data = JSON.parse(body);
                if (!data)
                  console.log("Something wrong with the api or syntax");

                let networkhashps = data.pools[0].networkStats.networkHashrate;

                let marketFactor = MiningMarketInfo.marketFactor;
                let MarketFactorName = MiningMarketInfo.marketFactorName;
                let Networkhashrate =
                  Math.round((networkhashps / marketFactor) * 1e3) / 1e3;

                resolve({ networkhashps, Networkhashrate, MarketFactorName });
              });
            })
            .on("error", (error) => {
              console.log("Error: " + error.message);
              reject("Error: " + error.message);
            });
        });
        return { networkhashps, Networkhashrate, MarketFactorName };
      }
      if (/RVN/.test(token)) {
        // console.log(/RVN/.test(token))
        // let Rvnnetworkstats = await rvnnetworkmininginfo();
        // let x = Rvnnetworkstats.x;
        // let blocks_by_pool = Rvnnetworkstats.blocks_by_pool
        let Rvnnetworkmininginfo = await rvnnetworkmininginfo();
        let networkhashps = Rvnnetworkmininginfo.networkhashps;
        let Networkhashrate = Rvnnetworkmininginfo.Networkhashrate;
        let MarketFactorName = Rvnnetworkmininginfo.MarketFactorName;
        let blocksPerHour = 60;
        let tokensPerBlock = 5000;

        return {
          blocksPerHour,
          tokensPerBlock,
          networkhashps,
          Networkhashrate,
          MarketFactorName,
        };
        // return ({x, blocks_by_pool, blocksPerHour,tokensPerBlock,networkhashps,Networkhashrate,MarketFactorName});
      } else {
        if (/FLO/.test(token)) {
          // console.log(/FLO/.test(token))
          let Flonetworkmininginfo = await flonetworkmininginfo();
          let networkhashps = Flonetworkmininginfo.networkhashps;
          let Networkhashrate = Flonetworkmininginfo.Networkhashrate;
          let MarketFactorName = Flonetworkmininginfo.MarketFactorName;
          let blocksPerHour = 90;
          let tokensPerBlock = 3.125;

          return {
            blocksPerHour,
            tokensPerBlock,
            networkhashps,
            MarketFactorName,
            Networkhashrate,
          };
        }
      }
    }

    async function exchanges() {
      async function priceusdperbtconcoinbase() {
        return await new Promise((resolve, reject) => {
          https
            .get(
              "https://api.coinbase.com/v2/exchange-rates?currency=BTC",
              (response) => {
                let body = "";
                response.on("data", (chunk) => {
                  body += chunk;
                });
                response.on("end", () => {
                  let data = JSON.parse(body);
                  if (!data)
                    console.log("Something wrong with the api or syntax");
                  let PriceUsdPerBtcOnCoinbase =
                    Math.round(data.data.rates.USD * 1e2) / 1e2;
                  resolve(PriceUsdPerBtcOnCoinbase);
                });
              }
            )
            .on("error", (error) => {
              console.log("Error: " + error.message);
              reject("Error: " + error.message);
            });
        });
      }

      async function priceperfloonbittrex() {
        return await new Promise((resolve, reject) => {
          https
            .get(
              "https://api.bittrex.com/api/v1.1/public/getticker?market=BTC-FLO",
              (response) => {
                let body = "";
                response.on("data", (chunk) => {
                  body += chunk;
                });
                response.on("end", () => {
                  let data = JSON.parse(body);
                  if (!data)
                    console.log("Something wrong with the api or syntax");
                  let bittrexMultiplier = 1;
                  let PriceBtcPerTokenOnBittrex =
                    Math.round(data.result.Last * bittrexMultiplier * 1e8) /
                    1e8;
                  resolve(PriceBtcPerTokenOnBittrex);
                });
              }
            )
            .on("error", (error) => {
              console.log("Error: " + error.message);
              reject("Error: " + error.message);
            });
        });
      }

      async function priceperrvnonbittrex() {
        return await new Promise((resolve, reject) => {
          https
            .get(
              "https://api.bittrex.com/api/v1.1/public/getticker?market=BTC-RVN",
              (response) => {
                let body = "";
                response.on("data", (chunk) => {
                  body += chunk;
                });
                response.on("end", () => {
                  let data = JSON.parse(body);
                  if (!data)
                    console.log("Something wrong with the api or syntax");
                  let bittrexMultiplier = 1;
                  let PriceBtcPerTokenOnBittrex =
                    Math.round(data.result.Last * bittrexMultiplier * 1e8) /
                    1e8;
                  resolve(PriceBtcPerTokenOnBittrex);
                });
              }
            )
            .on("error", (error) => {
              console.log("Error: " + error.message);
              reject("Error: " + error.message);
            });
        });
      }

      async function priceusdperbtconbittrex() {
        return await new Promise((resolve, reject) => {
          https
            .get(
              "https://api.bittrex.com/api/v1.1/public/getticker?market=USD-BTC",
              (response) => {
                let body = "";
                response.on("data", (chunk) => {
                  body += chunk;
                });
                response.on("end", () => {
                  let data = JSON.parse(body);
                  if (!data)
                    console.log("Something wrong with the api or syntax");
                  let bittrexMultiplier = 1;
                  let PriceUsdPerBtcOnBittrex =
                    Math.round(data.result.Last * bittrexMultiplier * 1e2) /
                    1e2;
                  resolve(PriceUsdPerBtcOnBittrex);
                });
              }
            )
            .on("error", (error) => {
              console.log("Error: " + error.message);
              reject("Error: " + error.message);
            });
        });
      }

      let token = UserInput.token;

      if (/RVN/.test(token)) {
        let TokenPair = "BTC-RVN";
        let PriceUsdPerBtcOnCoinbase = await priceusdperbtconcoinbase();
        let PriceBtcPerTokenOnBittrex = await priceperrvnonbittrex();
        let PriceUsdPerBtcOnBittrex = await priceusdperbtconbittrex();
        return {
          PriceUsdPerBtcOnCoinbase,
          PriceUsdPerBtcOnBittrex,
          TokenPair,
          PriceBtcPerTokenOnBittrex,
        };
      } else {
        if (/FLO/.test(token)) {
          let TokenPair = "BTC-FLO";
          let PriceUsdPerBtcOnCoinbase = await priceusdperbtconcoinbase();
          let PriceBtcPerTokenOnBittrex = await priceperfloonbittrex();
          let PriceUsdPerBtcOnBittrex = await priceusdperbtconbittrex();
          return {
            PriceUsdPerBtcOnCoinbase,
            PriceUsdPerBtcOnBittrex,
            TokenPair,
            PriceBtcPerTokenOnBittrex,
          };
        }
      }
    }

    async function calculations() {
      let NetworkPercent = UserInput.NetworkPercent;
      let UsersRequestedMargin = UserInput.margin;
      let Networkhashrate = NetworkMiningInfo.Networkhashrate;
      let PriceRentalStandard = MiningMarketInfo.PriceRentalStandard;
      let PriceBtcPerTokenOnBittrex = Exchanges.PriceBtcPerTokenOnBittrex;
      let tokensPerBlock = NetworkMiningInfo.tokensPerBlock;
      let blocksPerHour = NetworkMiningInfo.blocksPerHour;

      let HourlyMiningCostInBtc =
        Math.round(((Networkhashrate * PriceRentalStandard) / 24) * 1e6) / 1e6;

      let HourlyMiningValueInBtc =
        Math.round(
          blocksPerHour * tokensPerBlock * PriceBtcPerTokenOnBittrex * 1e6
        ) / 1e6;
      return { HourlyMiningValueInBtc, HourlyMiningCostInBtc };
    }

    async function minimums() {
      let token = UserInput.token;
      let BittrexWithdrawalFee = 0.0005;
      let BittrexMinWithdrawal = 0.0015;
      let nicehashMinRentalCost = 0.005;
      let Networkhashrate = NetworkMiningInfo.Networkhashrate;
      let marketFactor = MiningMarketInfo.marketFactor;
      let networkhashps = NetworkMiningInfo.networkhashps;
      let NetworkPercent = UserInput.NetworkPercent;
      let UsersRequestedMargin = UserInput.margin;
      let PriceRentalStandard = MiningMarketInfo.PriceRentalStandard;
      let PriceUsdPerBtcOnCoinbase = Exchanges.PriceUsdPerBtcOnCoinbase;
      let HourlyMiningValueInBtc = Calculations.HourlyMiningValueInBtc;
      let HourlyMiningCostInBtc = Calculations.HourlyMiningCostInBtc;
      let usersSelectedDuration = UserInput.duration;
      let MinPercentFromNHMinAmount =
        Math.ceil(
          (nicehashMinRentalCost /
            (((Networkhashrate * PriceRentalStandard) / 24) *
              usersSelectedDuration +
              nicehashMinRentalCost)) *
            1e6
        ) / 1e6;

      async function MinPercentFromNHMinLimitCalc() {
        async function MinPercentFromNHMinLimitKawpow() {
          let tokenAlgo = UserInput.tokenAlgo;
          let networkhashps = NetworkMiningInfo.networkhashps;
          let marketFactor = MiningMarketInfo.marketFactor;
          let Networkhashrate = networkhashps / marketFactor;
          let MinPercentFromNHMinLimitRvn =
            Math.round((0.1 / (Networkhashrate + 0.1)) * 1e8) / 1e8;
          return MinPercentFromNHMinLimitRvn;
        }

        async function MinPercentFromNHMinLimitScrypt() {
          let tokenAlgo = UserInput.tokenAlgo;
          let networkhashps = NetworkMiningInfo.networkhashps;
          let marketFactor = MiningMarketInfo.marketFactor;
          let Networkhashrate = networkhashps / marketFactor;
          let MinPercentFromNHMinLimitScrypt =
            Math.round((0.01 / (Networkhashrate + 0.01)) * 1e8) / 1e8;
          return MinPercentFromNHMinLimitScrypt;
        }

        let tokenAlgo = UserInput.tokenAlgo;
        if (/RVN/.test(token)) {
          // console.log(/RVN/.test(token));
          let MinPercentFromNHMinLimit = await MinPercentFromNHMinLimitKawpow();
          return { MinPercentFromNHMinLimit };
        } else {
          if (/FLO/.test(token)) {
            // console.log(/FLO/.test(token));
            let MinPercentFromNHMinLimit = await MinPercentFromNHMinLimitScrypt();
            return { MinPercentFromNHMinLimit };
          }
        }
        return { MinPercentFromNHMinLimit };
      }

      let tokenAlgo = UserInput.tokenAlgo;
      let MinPercentFromNHMinLimitLoad = await MinPercentFromNHMinLimitCalc();
      let MinPercentFromNHMinLimit =
        MinPercentFromNHMinLimitLoad.MinPercentFromNHMinLimit;
      let minMargin = 0;
      let MinPercentFromBittrexMinWithdrawal =
        Math.round(
          (BittrexMinWithdrawal /
            (BittrexMinWithdrawal +
              Networkhashrate * PriceRentalStandard * usersSelectedDuration)) *
            1e6
        ) / 1e6;
      let SpotProfitableDurMinFromPercentEquation1Conditional1 =
        BittrexWithdrawalFee -
        nicehashMinRentalCost *
          ((HourlyMiningValueInBtc - NetworkPercent * HourlyMiningValueInBtc) /
            (minMargin * HourlyMiningCostInBtc + HourlyMiningCostInBtc) -
            1);
      let SpotProfitableDurMinFromPercentEquation1Conditional2 = nicehashMinRentalCost;
      let SpotProfitableDurMinFromPercentEquation1Conditional3 =
        HourlyMiningValueInBtc -
        -((minMargin + 1) * HourlyMiningCostInBtc) / (NetworkPercent - 1);
      let SpotProfitableDurMinFromPercentEquation1Conditional4 = HourlyMiningCostInBtc;
      let SpotProfitableDurMinFromPercentEquation1Conditional5 = minMargin;
      let SpotProfitableDurMinFromPercentEquation1Conditional6 = -(
        NetworkPercent - 1
      );
      let SpotProfitableDurMinFromPercentEquation1Conditionals = false;
      let SpotProfitableDurMinFromPercentEquation2Conditional1 = BittrexWithdrawalFee;
      let SpotProfitableDurMinFromPercentEquation2Conditional2 =
        (-nicehashMinRentalCost * minMargin * HourlyMiningCostInBtc -
          nicehashMinRentalCost * NetworkPercent * HourlyMiningValueInBtc -
          nicehashMinRentalCost * HourlyMiningCostInBtc +
          nicehashMinRentalCost * HourlyMiningValueInBtc) /
          ((minMargin + 1) * HourlyMiningCostInBtc) -
        BittrexWithdrawalFee;
      let SpotProfitableDurMinFromPercentEquation2Conditional3 = nicehashMinRentalCost;
      let SpotProfitableDurMinFromPercentEquation2Conditional4 =
        HourlyMiningValueInBtc -
        -((minMargin + 1) * HourlyMiningCostInBtc) / (NetworkPercent - 1);
      let SpotProfitableDurMinFromPercentEquation2Conditional5 = HourlyMiningCostInBtc;
      let SpotProfitableDurMinFromPercentEquation2Conditional6 = minMargin;
      let SpotProfitableDurMinFromPercentEquation2Conditional7 = NetworkPercent;
      let SpotProfitableDurMinFromPercentEquation2Conditionals = false;
      let SpotProfitableDurationMinimumFromPercentExists = false;
      let MaximumMinimum = Math.max(
        MinPercentFromNHMinAmount,
        MinPercentFromNHMinLimit,
        MinPercentFromBittrexMinWithdrawal
      );
      let MinimumSpotProfitableDurMinFromPercentEquation1Conditional = Math.min(
        SpotProfitableDurMinFromPercentEquation1Conditional1,
        SpotProfitableDurMinFromPercentEquation1Conditional2,
        SpotProfitableDurMinFromPercentEquation1Conditional3,
        SpotProfitableDurMinFromPercentEquation1Conditional4,
        SpotProfitableDurMinFromPercentEquation1Conditional5,
        SpotProfitableDurMinFromPercentEquation1Conditional6
      );
      let MinimumSpotProfitableDurMinFromPercentEquation2Conditional = Math.min(
        SpotProfitableDurMinFromPercentEquation2Conditional1,
        SpotProfitableDurMinFromPercentEquation2Conditional2,
        SpotProfitableDurMinFromPercentEquation2Conditional3,
        SpotProfitableDurMinFromPercentEquation2Conditional4,
        SpotProfitableDurMinFromPercentEquation2Conditional5,
        SpotProfitableDurMinFromPercentEquation2Conditional6
      );
      let duration = usersSelectedDuration;
      // console.log(MinPercentFromNHMinAmount,MinPercentFromNHMinLimit,MinPercentFromBittrexMinWithdrawal,MaximumMinimum,NetworkPercent)
      if (MaximumMinimum < NetworkPercent) {
        // console.log(MaximumMinimum < NetworkPercent)
        if (MinimumSpotProfitableDurMinFromPercentEquation1Conditional > 0) {
          let SpotProfitableDurMinFromPercentEquation1Conditionals = true;
          let SpotProfitableDurationMinimumFromPercentExists = true;
          let SpotProfitableDurationMinimumFromPercent =
            Math.round(
              ((BittrexWithdrawalFee * (minMargin + 1) * (NetworkPercent - 1)) /
                (NetworkPercent *
                  ((minMargin + 1) * Calculations.HourlyMiningCostInBtc +
                    (NetworkPercent - 1) *
                      Calculations.HourlyMiningValueInBtc))) *
                1e2
            ) / 1e2;
          let SpotProfitableDurationMinimumFromPercentWholeHrs = Math.round(
            SpotProfitableDurationMinimumFromPercent
          );
          let SpotProfitableDurationMinimumFromPercentMinutes = Math.round(
            60 *
              (SpotProfitableDurationMinimumFromPercent -
                SpotProfitableDurationMinimumFromPercentWholeHrs)
          );
          let duration = SpotProfitableDurationMinimumFromPercent;
        } else {
          let SpotProfitableDurMinFromPercentEquation1Conditionals = false;
          let SpotProfitableDurationMinimumFromPercentExists = false;
          let duration = usersSelectedDuration;
        }
        if (MinimumSpotProfitableDurMinFromPercentEquation2Conditional > 0) {
          let SpotProfitableDurMinFromPercentEquation2Conditionals = true;
          let SpotProfitableDurationMinimumFromPercentExists = true;
          let SpotProfitableDurationMinimumFromPercent =
            Math.round(
              ((nicehashMinRentalCost -
                nicehashMinRentalCost * NetworkPercent) /
                (NetworkPercent * HourlyMiningCostInBtc)) *
                1e2
            ) / 1e2;
          let SpotProfitableDurationMinimumFromPercentWholeHrs = Math.round(
            SpotProfitableDurationMinimumFromPercent
          );
          let SpotProfitableDurationMinimumFromPercentMinutes = Math.round(
            60 *
              (SpotProfitableDurationMinimumFromPercent -
                SpotProfitableDurationMinimumFromPercentWholeHrs)
          );
          let duration = SpotProfitableDurationMinimumFromPercent;
        } else {
          let SpotProfitableDurMinFromPercentEquation2Conditionals = false;
          let SpotProfitableDurationMinimumFromPercentExists = false;
          let duration = usersSelectedDuration;
        }
      } else {
        let AboveMinimums = false;
        let SpotProfitableDurationMinimumFromPercentExists = false;
        let duration = usersSelectedDuration;
      }
      let AboveMinimums = MaximumMinimum < NetworkPercent;
      let SpotProfitableDurationMinimumFromPercent = 0;
      return {
        MinPercentFromNHMinAmount,
        MinPercentFromNHMinLimit,
        MinPercentFromBittrexMinWithdrawal,
        NetworkPercent,
        AboveMinimums,
        SpotProfitableDurMinFromPercentEquation1Conditionals,
        SpotProfitableDurMinFromPercentEquation2Conditionals,
        SpotProfitableDurationMinimumFromPercentExists,
        SpotProfitableDurationMinimumFromPercent,
        duration,
      };
    }

    async function spotprofitablemodemins() {
      let BittrexWithdrawalFee = 0.0005;
      let NicehashMinRentalCost = 0.005;
      let HourlyMiningCostInBtc = Calculations.HourlyMiningCostInBtc;
      let HourlyMiningValueInBtc = Calculations.HourlyMiningValueInBtc;
      let minMargin = 0;

      //Min and Max Profitable Percent, Equation 1
      //Finds a minimum duration that could potentially be profitable, given the conditions are true
      let SpotProfitablePercentEquation1DurationMinimum =
        Math.round(
          ((2 *
            Math.pow(HourlyMiningCostInBtc, 2) *
            Math.sqrt(
              (HourlyMiningCostInBtc *
                Math.pow(BittrexWithdrawalFee, 2) *
                HourlyMiningValueInBtc) /
                Math.pow(HourlyMiningCostInBtc - HourlyMiningValueInBtc, 4)
            ) +
            2 *
              Math.pow(HourlyMiningValueInBtc, 2) *
              Math.sqrt(
                (HourlyMiningCostInBtc *
                  Math.pow(BittrexWithdrawalFee, 2) *
                  HourlyMiningValueInBtc) /
                  Math.pow(HourlyMiningCostInBtc - HourlyMiningValueInBtc, 4)
              ) -
            4 *
              HourlyMiningCostInBtc *
              HourlyMiningValueInBtc *
              Math.sqrt(
                (HourlyMiningCostInBtc *
                  Math.pow(BittrexWithdrawalFee, 2) *
                  HourlyMiningValueInBtc) /
                  Math.pow(HourlyMiningCostInBtc - HourlyMiningValueInBtc, 4)
              ) +
            HourlyMiningCostInBtc * BittrexWithdrawalFee +
            BittrexWithdrawalFee * HourlyMiningValueInBtc) /
            Math.pow(HourlyMiningCostInBtc - HourlyMiningValueInBtc, 2)) *
            1e4
        ) / 1e4;
      let SpotProfitablePercentEquation1DurationMinimumHours =
        Math.round(SpotProfitablePercentEquation1DurationMinimum * 1) / 1;
      let SpotProfitablePercentEquation1DurationMinimumMinutes =
        Math.round(
          (SpotProfitablePercentEquation1DurationMinimum -
            SpotProfitablePercentEquation1DurationMinimumHours) *
            60 *
            1
        ) / 1;

      //Conditionals for equation 1
      let SpotProfitablePercentEquation1Conditional1 =
        (1 / 2) *
          -Math.sqrt(
            Math.pow(HourlyMiningCostInBtc, 2) *
              Math.pow(SpotProfitablePercentEquation1DurationMinimum, 2) -
              2 *
                HourlyMiningCostInBtc *
                Math.pow(SpotProfitablePercentEquation1DurationMinimum, 2) *
                HourlyMiningValueInBtc -
              2 *
                HourlyMiningCostInBtc *
                SpotProfitablePercentEquation1DurationMinimum *
                BittrexWithdrawalFee +
              Math.pow(SpotProfitablePercentEquation1DurationMinimum, 2) *
                Math.pow(HourlyMiningValueInBtc, 2) -
              2 *
                SpotProfitablePercentEquation1DurationMinimum *
                BittrexWithdrawalFee *
                HourlyMiningValueInBtc +
              Math.pow(BittrexWithdrawalFee, 2) -
              HourlyMiningCostInBtc *
                SpotProfitablePercentEquation1DurationMinimum +
              SpotProfitablePercentEquation1DurationMinimum *
                HourlyMiningValueInBtc -
              BittrexWithdrawalFee
          ) -
        NicehashMinRentalCost;
      let SpotProfitablePercentEquation1Conditional2 =
        HourlyMiningValueInBtc - HourlyMiningCostInBtc;

      //Combines the conditionals for equation 1 by finding their min value
      let SpotProfitablePercentEquation1ConditionalsMinMin = Math.min(
        SpotProfitablePercentEquation1Conditional1,
        SpotProfitablePercentEquation1Conditional2
      );

      //calculates the min and max percents
      let MinimumProfitablePercentEquation1 =
        (-SpotProfitablePercentEquation1DurationMinimum *
          HourlyMiningValueInBtc *
          Math.sqrt(
            (Math.pow(HourlyMiningCostInBtc, 2) *
              Math.pow(SpotProfitablePercentEquation1DurationMinimum, 2) -
              2 *
                HourlyMiningCostInBtc *
                Math.pow(SpotProfitablePercentEquation1DurationMinimum, 2) *
                HourlyMiningValueInBtc -
              2 *
                HourlyMiningCostInBtc *
                SpotProfitablePercentEquation1DurationMinimum *
                BittrexWithdrawalFee +
              Math.pow(SpotProfitablePercentEquation1DurationMinimum, 2) *
                Math.pow(HourlyMiningValueInBtc, 2) -
              2 *
                SpotProfitablePercentEquation1DurationMinimum *
                BittrexWithdrawalFee *
                HourlyMiningValueInBtc +
              Math.pow(BittrexWithdrawalFee, 2)) /
              (Math.pow(SpotProfitablePercentEquation1DurationMinimum, 2) *
                Math.pow(HourlyMiningValueInBtc, 2))
          ) -
          HourlyMiningCostInBtc *
            SpotProfitablePercentEquation1DurationMinimum +
          SpotProfitablePercentEquation1DurationMinimum *
            HourlyMiningValueInBtc +
          BittrexWithdrawalFee) /
        (2 *
          SpotProfitablePercentEquation1DurationMinimum *
          HourlyMiningValueInBtc);
      let MaximumProfitablePercentEquation1 =
        (SpotProfitablePercentEquation1DurationMinimum *
          HourlyMiningValueInBtc *
          Math.sqrt(
            (Math.pow(HourlyMiningCostInBtc, 2) *
              Math.pow(SpotProfitablePercentEquation1DurationMinimum, 2) -
              2 *
                HourlyMiningCostInBtc *
                Math.pow(SpotProfitablePercentEquation1DurationMinimum, 2) *
                HourlyMiningValueInBtc -
              2 *
                HourlyMiningCostInBtc *
                SpotProfitablePercentEquation1DurationMinimum *
                BittrexWithdrawalFee +
              Math.pow(SpotProfitablePercentEquation1DurationMinimum, 2) *
                Math.pow(HourlyMiningValueInBtc, 2) -
              2 *
                SpotProfitablePercentEquation1DurationMinimum *
                BittrexWithdrawalFee *
                HourlyMiningValueInBtc +
              Math.pow(BittrexWithdrawalFee, 2)) /
              (Math.pow(SpotProfitablePercentEquation1DurationMinimum, 2) *
                Math.pow(HourlyMiningValueInBtc, 2))
          ) -
          HourlyMiningCostInBtc *
            SpotProfitablePercentEquation1DurationMinimum +
          SpotProfitablePercentEquation1DurationMinimum *
            HourlyMiningValueInBtc +
          BittrexWithdrawalFee) /
        (2 *
          SpotProfitablePercentEquation1DurationMinimum *
          HourlyMiningValueInBtc);

      //Min and Max Profitable Percent, Equation 2
      //Finds a minimum duration that could potentially be profitable, given the conditions are true
      let SpotProfitablePercentEquation2DurationMinimum =
        Math.round(
          ((2 *
            Math.pow(HourlyMiningCostInBtc, 2) *
            Math.sqrt(
              (HourlyMiningCostInBtc *
                Math.pow(BittrexWithdrawalFee, 2) *
                HourlyMiningValueInBtc) /
                Math.pow(HourlyMiningCostInBtc - HourlyMiningValueInBtc, 4)
            ) +
            2 *
              Math.pow(HourlyMiningValueInBtc, 2) *
              Math.sqrt(
                (HourlyMiningCostInBtc *
                  Math.pow(BittrexWithdrawalFee, 2) *
                  HourlyMiningValueInBtc) /
                  Math.pow(HourlyMiningCostInBtc - HourlyMiningValueInBtc, 4)
              ) -
            4 *
              HourlyMiningCostInBtc *
              HourlyMiningValueInBtc *
              Math.sqrt(
                (HourlyMiningCostInBtc *
                  Math.pow(BittrexWithdrawalFee, 2) *
                  HourlyMiningValueInBtc) /
                  Math.pow(HourlyMiningCostInBtc - HourlyMiningValueInBtc, 4)
              ) +
            HourlyMiningCostInBtc * HourlyMiningValueInBtc +
            BittrexWithdrawalFee * HourlyMiningValueInBtc) /
            (Math.pow(HourlyMiningCostInBtc - HourlyMiningValueInBtc), 2)) *
            1e4
        ) / 1e4;
      let SpotProfitablePercentEquation2DurationMinimumHours =
        Math.round(SpotProfitablePercentEquation2DurationMinimum * 1) / 1;
      let SpotProfitablePercentEquation2DurationMinimumMinutes =
        Math.round(
          (SpotProfitablePercentEquation2DurationMinimum -
            SpotProfitablePercentEquation2DurationMinimumHours) *
            60 *
            1
        ) / 1;

      //Conditionals for equation 2
      let SpotProfitablePercentEquation2Conditional1 =
        (1 / 2) *
          (-Math.sqrt(
            Math.pow(HourlyMiningCostInBtc, 2) *
              Math.pow(SpotProfitablePercentEquation2DurationMinimum, 2) -
              2 *
                HourlyMiningCostInBtc *
                Math.pow(SpotProfitablePercentEquation2DurationMinimum, 2) *
                HourlyMiningValueInBtc -
              2 *
                HourlyMiningCostInBtc *
                SpotProfitablePercentEquation2DurationMinimum *
                BittrexWithdrawalFee +
              Math.pow(SpotProfitablePercentEquation2DurationMinimum, 2) *
                Math.pow(HourlyMiningValueInBtc, 2) -
              2 *
                SpotProfitablePercentEquation2DurationMinimum *
                BittrexWithdrawalFee *
                HourlyMiningValueInBtc +
              Math.pow(BittrexWithdrawalFee, 2)
          ) -
            HourlyMiningCostInBtc *
              SpotProfitablePercentEquation2DurationMinimum +
            SpotProfitablePercentEquation2DurationMinimum *
              HourlyMiningValueInBtc -
            BittrexWithdrawalFee) -
        NicehashMinRentalCost;
      console.log(SpotProfitablePercentEquation2Conditional1);

      let SpotProfitablePercentEquation2Conditional2 =
        NicehashMinRentalCost -
        (1 / 2) *
          (-Math.sqrt(
            Math.pow(HourlyMiningCostInBtc, 2) *
              Math.pow(SpotProfitablePercentEquation2DurationMinimum, 2) -
              2 *
                HourlyMiningCostInBtc *
                Math.pow(SpotProfitablePercentEquation2DurationMinimum, 2) *
                HourlyMiningValueInBtc -
              2 *
                HourlyMiningCostInBtc *
                SpotProfitablePercentEquation2DurationMinimum *
                BittrexWithdrawalFee +
              Math.pow(SpotProfitablePercentEquation2DurationMinimum, 2) *
                Math.pow(HourlyMiningValueInBtc, 2) -
              2 *
                SpotProfitablePercentEquation2DurationMinimum *
                BittrexWithdrawalFee *
                HourlyMiningValueInBtc +
              Math.pow(BittrexWithdrawalFee, 2)
          ) -
            HourlyMiningCostInBtc *
              SpotProfitablePercentEquation2DurationMinimum +
            SpotProfitablePercentEquation2DurationMinimum *
              HourlyMiningValueInBtc -
            BittrexWithdrawalFee);
      console.log(SpotProfitablePercentEquation2Conditional1);

      //Combines the conditionals for equation 2 by finding their min value
      let SpotProfitablePercentEquation2ConditionalsMinMin = Math.min(
        SpotProfitablePercentEquation2Conditional1,
        SpotProfitablePercentEquation2Conditional2
      );

      if (SpotProfitablePercentEquation1ConditionalsMinMin > 0) {
        if (SpotProfitablePercentEquation2ConditionalsMinMin > 0) {
          //if both equations are good
          let SpotProfitablePercentEquation1Conditionals = true;

          return {
            SpotProfitablePercentEquation1DurationMinimum,
            SpotProfitablePercentEquation1DurationMinimumHours,
            SpotProfitablePercentEquation1DurationMinimumMinutes,
            SpotProfitablePercentEquation1Conditional1,
            SpotProfitablePercentEquation1Conditional2,
            SpotProfitablePercentEquation2Conditional1,
            SpotProfitablePercentEquation2Conditional2,
            SpotProfitablePercentEquation1ConditionalsMinMin,
            SpotProfitablePercentEquation1Conditionals,
            MinimumProfitablePercentEquation1,
            MaximumProfitablePercentEquation1,
            SpotProfitablePercentEquation2Conditional1,
            SpotProfitablePercentEquation2Conditionals,
            SpotProfitablePercentEquation2ConditionalsMinMin,
          };
        } //if just the first equation is good
        let SpotProfitablePercentEquation1Conditionals = true;
        let SpotProfitablePercentEquation2Conditionals = false;

        return {
          SpotProfitablePercentEquation1DurationMinimum,
          SpotProfitablePercentEquation1DurationMinimumHours,
          SpotProfitablePercentEquation1DurationMinimumMinutes,
          SpotProfitablePercentEquation1Conditional1,
          SpotProfitablePercentEquation1Conditional2,
          SpotProfitablePercentEquation1ConditionalsMinMin,
          SpotProfitablePercentEquation2Conditional1,
          SpotProfitablePercentEquation2Conditional2,
          SpotProfitablePercentEquation2Conditionals,
          SpotProfitablePercentEquation1Conditionals,
          MinimumProfitablePercentEquation1,
          MaximumProfitablePercentEquation1,
          SpotProfitablePercentEquation2ConditionalsMinMin,
        };
      } else {
        //if the first equation isn't good
        if (SpotProfitablePercentEquation2ConditionalsMinMin > 0) {
          //and the second one is
          let SpotProfitablePercentEquation1Conditionals = false;
          let SpotProfitablePercentEquation2Conditionals = true;

          return {
            SpotProfitablePercentEquation2DurationMinimum,
            SpotProfitablePercentEquation2DurationMinimumHours,
            SpotProfitablePercentEquation2DurationMinimumMinutes,
            SpotProfitablePercentEquation2Conditional1,
            SpotProfitablePercentEquation2Conditional2,
            SpotProfitablePercentEquation2ConditionalsMinMin,
            SpotProfitablePercentEquation2Conditionals,
            SpotProfitablePercentEquation2DurationMinimum,
            SpotProfitablePercentEquation2DurationMinimumHours,
            SpotProfitablePercentEquation2DurationMinimumMinutes,
          };
        } //if niether equation is good

        let SpotProfitablePercentEquation1Conditionals = false;
        let SpotProfitablePercentEquation2Conditionals = false;
        let MaximumProfitablePercentEquation1 = 0;
        let MinimumProfitablePercentEquation1 = 0;
        return {
          SpotProfitablePercentEquation1DurationMinimum,
          SpotProfitablePercentEquation1DurationMinimumHours,
          SpotProfitablePercentEquation1Conditional1,
          SpotProfitablePercentEquation1Conditional2,
          SpotProfitablePercentEquation1ConditionalsMinMin,
          SpotProfitablePercentEquation1Conditionals,
          MinimumProfitablePercentEquation1,
          MaximumProfitablePercentEquation1,
          SpotProfitablePercentEquation2DurationMinimum,
          SpotProfitablePercentEquation2Conditional1,
          SpotProfitablePercentEquation2Conditional2,
          SpotProfitablePercentEquation2ConditionalsMinMin,
          SpotProfitablePercentEquation2Conditionals,
        };
      } //or maybe here, check this too
    }

    async function alwaysminemodeestimates() {
      let MinPercentFromNHMinAmount = Minimums.MinPercentFromNHMinAmount;
      let MinPercentFromNHMinLimit = Minimums.MinPercentFromNHMinLimit;
      let MinPercentFromBittrexMinWithdrawal =
        Minimums.MinPercentFromBittrexMinWithdrawal;
      let AboveMinimums = Minimums.AboveMinimums;
      let BittrexWithdrawalFee = 0.0005;
      let BittrexMinWithdrawal = 0.0015;
      let nicehashMinRentalCost = 0.005;
      let blocksPerHour = NetworkMiningInfo.blocksPerHour;
      let tokensPerBlock = NetworkMiningInfo.tokensPerBlock;
      let NetworkPercent = UserInput.NetworkPercent;
      let UsersRequestedMargin = UserInput.margin;
      let Networkhashrate = NetworkMiningInfo.Networkhashrate;
      let usersSelectedDuration = Minimums.duration;
      let SpotProfitableDurationMinimumFromPercent =
        Minimums.SpotProfitableDurationMinimumFromPercent;
      let SpotProfitableDurationMinimumFromPercentExists =
        Minimums.SpotProfitableDurationMinimumFromPercentExists;
      let duration = Math.max(
        SpotProfitableDurationMinimumFromPercent,
        usersSelectedDuration
      );
      let MarketPriceUsdPerBtc = Exchanges.PriceUsdPerBtcOnCoinbase; //Coinbase.priceUsdPerBtc
      let MarketPricePerTokenInBtc = Exchanges.PriceBtcPerTokenOnBittrex; //Bittrex.priceBtcPerToken
      let Rent =
        Math.round(
          NetworkMiningInfo.Networkhashrate *
            (-NetworkPercent / (-1 + NetworkPercent)) *
            1e3
        ) / 1e3;
      let MarketFactorName = MiningMarketInfo.marketFactorName;
      let CostOfRentalInBtc =
        Math.round(
          ((Rent * duration) / 24) * MiningMarketInfo.PriceRentalStandard * 1e8
        ) / 1e8;
      let CostOfRentalInUsd =
        Math.round(CostOfRentalInBtc * MarketPriceUsdPerBtc * 1e2) / 1e2;
      let EstimatedQtyOfTokensToBeMined =
        Math.round(
          NetworkPercent * tokensPerBlock * blocksPerHour * duration * 1e5
        ) / 1e5;
      let ValueOfEstTokensAtMarketPrice =
        Math.round(
          (EstimatedQtyOfTokensToBeMined * MarketPricePerTokenInBtc -
            BittrexWithdrawalFee) *
            1e8
        ) / 1e8;
      let ValueOfEstTokensAtMktPriceUsd =
        Math.round(ValueOfEstTokensAtMarketPrice * MarketPriceUsdPerBtc * 1e2) /
        1e2;
      let TargetOfferPricePerMinedToken =
        Math.round(
          Math.max(
            ((CostOfRentalInBtc + BittrexWithdrawalFee) *
              (1 + UsersRequestedMargin)) /
              EstimatedQtyOfTokensToBeMined,
            MarketPricePerTokenInBtc
          ) * 1e8
        ) / 1e8;
      let MarketVsOfferSpread =
        Math.round(
          ((MarketPricePerTokenInBtc - TargetOfferPricePerMinedToken) /
            Math.max(TargetOfferPricePerMinedToken, MarketPricePerTokenInBtc)) *
            1e2
        ) / 1e2;
      let ValueOfEstTokensAtTargetOffer =
        Math.round(
          (TargetOfferPricePerMinedToken * EstimatedQtyOfTokensToBeMined -
            BittrexWithdrawalFee) *
            1e8
        ) / 1e8;
      let ValueOfEstTokensAtTgtOfferUsd =
        Math.round(ValueOfEstTokensAtTargetOffer * MarketPriceUsdPerBtc * 1e2) /
        1e2;
      let ProfitUsd =
        Math.round((ValueOfEstTokensAtTgtOfferUsd - CostOfRentalInUsd) * 1e2) /
        1e2;
      let SpartanMerchantArbitragePrcnt =
        Math.round(
          ((ValueOfEstTokensAtMarketPrice - CostOfRentalInBtc) /
            CostOfRentalInBtc) *
            1e3
        ) / 1e3;

      let hashrate = Rent;
      let amount = CostOfRentalInBtc;
      let price = MiningMarketInfo.PriceRentalStandard;

      return {
        NetworkPercent,
        MinPercentFromNHMinAmount,
        MinPercentFromNHMinLimit,
        MinPercentFromBittrexMinWithdrawal,
        AboveMinimums,
        Rent,
        amount,
        price,
        duration,
        SpotProfitableDurationMinimumFromPercentExists,
        SpotProfitableDurationMinimumFromPercent,
        usersSelectedDuration,
        duration,
        NetworkPercent,
        Rent,
        MarketFactorName,
        EstimatedQtyOfTokensToBeMined,
        MarketPricePerTokenInBtc,
        TargetOfferPricePerMinedToken,
        MarketVsOfferSpread,
        CostOfRentalInBtc,
        ValueOfEstTokensAtMarketPrice,
        ValueOfEstTokensAtTargetOffer,
        CostOfRentalInUsd,
        ValueOfEstTokensAtTgtOfferUsd,
        ValueOfEstTokensAtMktPriceUsd,
        ProfitUsd,
        SpartanMerchantArbitragePrcnt,
        UsersRequestedMargin,
      };
    }

    // async function maxmarginminimums () {
    //   let nicehashMinRentalCost = 0.005;
    //   let BittrexWithdrawalFee = 0.0015;
    //   let HourlyMiningValueInBtc = Calculations.HourlyMiningValueInBtc;
    //   let HourlyMiningCostInBtc = Calculations.HourlyMiningCostInBtc;

    //   let MaxPercent = (nicehashMinRentalCost * (()/(HourlyMiningCostInBtc * )-1))

    // }

    async function rentedminingresults() {
      // async function miningfloonmlgpoolresults() {
      //   return await new Promise((resolve, reject) => {
      //     let token = UserInput.token;
      //     console.log(token);
      //     let worker = UserInput.worker;
      //     let CostOfRentalInBtc = UserInput.CostOfRentalInBtc;
      //     let rentalPercentComplete = UserInput.rentalPercentComplete;
      //     let endpointbase = 'https://pool.mediciland.com/api/pools/flo1/miners/';
      //     let URL = endpointbase.concat(worker);
      //     let marketFactor = MiningMarketInfo.marketFactor;
      //     let marketFactorName = MiningMarketInfo.marketFactorName;
      //     let expectedRewardFromRental = AlwaysMineModeEstimates.EstimatedQtyOfTokensToBeMined;
      //     https.get(URL, (response, reject) => {;
      //       let ErrOr = "mlgpool";
      //       console.log(response.statusCode, ErrOr)
      //       if (response.statusCode === 404) {; //pool is down
      //         let minerStatus = "Pool is down";
      //         resolve({minerStatus});
      //       }
      //       else{  //pool is alive
      //         let body = ''
      //         response.on('data', (chunk) => {
      //           body += chunk;
      //         });
      //         response.on('end', () => {;
      //           let data = JSON.parse(body);
      //          // if(!data) console.log('Something wrong with the api or syntax');
      //           let performance = data.performance
      //           let pendingShares = data.pendingShares
      //           if (performance === null){
      //             // if (pendingShares === 0){

      //             //   let minerStatus = "Worker address invalid, or lazy miner has not started yet";

      //             // }

      //            //worker isnt working
      //             let CostOfRentalInBtc = UserInput.CostOfRentalInBtc;
      //             let rentalPercentComplete = UserInput.rentalPercentComplete;
      //             let workers = 0;
      //             let currentHashrate = 0;
      //             let minerStatus = "Worker address invalid, or lazy miner has not started yet";
      //             let minerStatusCode = 4000;
      //             let currentHashrateReadable = currentHashrate / marketFactor;
      //             let rewardInSatsL30D = 0;
      //             let rewardInTokensL30D = 0;
      //             let rewardSoFarVsExpectedTotal =
      //             Math.round((
      //               rewardInTokensL30D - expectedRewardFromRental
      //               )*1e2)/1e2;
      //             let rewardSoFarVsExpectedTotalPercent = -1;
      //             let rewardsStillPending = false;
      //             let LiveEstimateOfferPrice = false;
      //             let LiveEstimateQtyOfTokensToBeMined = false;
      //             let MarketPricePerTokenInBtc = AlwaysMineModeEstimates.MarketPricePerTokenInBtc;
      //             resolve({minerStatus, minerStatusCode, workers,currentHashrate, currentHashrateReadable, marketFactorName, rewardInTokensL30D, rentalPercentComplete, expectedRewardFromRental, rewardSoFarVsExpectedTotal, rewardSoFarVsExpectedTotalPercent, rewardsStillPending, CostOfRentalInBtc, LiveEstimateQtyOfTokensToBeMined, LiveEstimateOfferPrice, MarketPricePerTokenInBtc});
      //           }else if (performance !== null){
      //             console.log ("lazy", performance);
      //             let minerStatus = "Mining has started";
      //             let minerStatusCode = 2000;
      //             let currentHashrate = data.currentHashrate;
      //             let currentHashrateReadable = currentHashrate / marketFactor;
      //             let rewardInSatsL30D = data.sumrewards[4].reward;
      //             let rewardInTokensL30D = rewardInSatsL30D / 1e8;
      //             let rewardSoFarVsExpectedTotal =
      //             Math.round((
      //               rewardInTokensL30D - expectedRewardFromRental
      //               )*1e2)/1e2;
      //             let rewardSoFarVsExpectedTotalPercent = rewardSoFarVsExpectedTotal / expectedRewardFromRental;
      //             let rewardsStillPending = data.rewards[0].immature;
      //             // let rentalPercentComplete = .192; //replace with function that pulls live data
      //             let CostOfRentalInBtc = 0.00095920; //replace with function that pulls live data
      //             let BittrexWithdrawalFee = .0005;
      //             let LiveEstimateQtyOfTokensToBeMined =
      //               Math.round((
      //               rewardInTokensL30D / rentalPercentComplete
      //               )*1e2)/1e2;
      //             let LiveEstimateOfferPrice =
      //               Math.round((
      //               (CostOfRentalInBtc + BittrexWithdrawalFee)/LiveEstimateQtyOfTokensToBeMined
      //               )*1e8)/1e8;
      //             let MarketPricePerTokenInBtc = AlwaysMineModeEstimates.MarketPricePerTokenInBtc;
      //             let workers = data.workersOnline;
      //             resolve({minerStatus, workers,minerStatusCode, currentHashrate,currentHashrateReadable,marketFactorName, rewardInTokensL30D, rentalPercentComplete, expectedRewardFromRental, rewardSoFarVsExpectedTotal, rewardSoFarVsExpectedTotalPercent, rewardSoFarVsExpectedTotal,rewardsStillPending,CostOfRentalInBtc, LiveEstimateQtyOfTokensToBeMined, LiveEstimateOfferPrice, MarketPricePerTokenInBtc})
      //           }
      //         });
      //       }
      //     }).on("error", (error) => {
      //         console.log("Error: " + error.message);
      //         reject("Error: " + error.message)
      //     })
      //   })
      // };

      async function miningrvnon2minersresults() {
        return await new Promise((resolve, reject) => {
          let token = UserInput.token;
          console.log(token);
          if ((token = "FLO")) {
            resolve({ token });
          } else;
          let worker = UserInput.worker;
          let endpointbase = "https://rvn.2miners.com/api/accounts/";
          let URL = endpointbase.concat(worker);
          let rentalPercentComplete = UserInput.rentalPercentComplete; //replace with function that pulls live data
          let CostOfRentalInBtc = UserInput.CostOfRentalInBtc; //replace with function that pulls live data
          let marketFactor = MiningMarketInfo.marketFactor;
          let marketFactorName = MiningMarketInfo.marketFactorName;
          let expectedRewardFromRental =
            AlwaysMineModeEstimates.EstimatedQtyOfTokensToBeMined;

          https
            .get(URL, (response, reject) => {
              let ErrOr = "2miners";
              console.log(response.statusCode, ErrOr);
              if (response.statusCode === 404) {
                //no work received yet
                let workers = 0;
                let currentHashrate = 0;

                let minerStatus =
                  "Worker address invalid, or lazy miner has not started yet";
                let minerStatusCode = 4000;
                let currentHashrateReadable = currentHashrate / marketFactor;
                let rewardInSatsL30D = 0;
                let rewardInTokensL30D = 0;
                let rewardSoFarVsExpectedTotal =
                  Math.round(
                    (rewardInTokensL30D - expectedRewardFromRental) * 1e2
                  ) / 1e2;
                let rewardSoFarVsExpectedTotalPercent = -1;
                let rewardsStillPending = false;

                let LiveEstimateOfferPrice = false;
                let LiveEstimateQtyOfTokensToBeMined = false;
                let MarketPricePerTokenInBtc =
                  AlwaysMineModeEstimates.MarketPricePerTokenInBtc;
                resolve({
                  minerStatus,
                  minerStatusCode,
                  workers,
                  currentHashrate,
                  currentHashrateReadable,
                  marketFactorName,
                  rewardInTokensL30D,
                  rentalPercentComplete,
                  expectedRewardFromRental,
                  rewardSoFarVsExpectedTotal,
                  rewardSoFarVsExpectedTotalPercent,
                  rewardsStillPending,
                  CostOfRentalInBtc,
                  LiveEstimateQtyOfTokensToBeMined,
                  LiveEstimateOfferPrice,
                  MarketPricePerTokenInBtc,
                });
              } else {
                //work has been received
                let body = "";
                response.on("data", (chunk) => {
                  body += chunk;
                });
                response.on("end", () => {
                  let data = JSON.parse(body);
                  // console.log (data)
                  let rewards = data.rewards;
                  if (rewards === null) {
                    let minerStatus =
                      "Mining has started but no blocks have been found since";
                    let minerStatusCode = 2001;
                    let currentHashrate = data.currentHashrate;
                    let currentHashrateReadable =
                      currentHashrate / marketFactor;
                    let rewardInSatsL30D = 0;
                    let rewardInTokensL30D = 0;

                    let rewardSoFarVsExpectedTotal =
                      Math.round(
                        (rewardInTokensL30D - expectedRewardFromRental) * 1e2
                      ) / 1e2;
                    let rewardSoFarVsExpectedTotalPercent = -1;
                    let rewardsStillPending = false;

                    let LiveEstimateOfferPrice = false;
                    let LiveEstimateQtyOfTokensToBeMined = false;
                    let MarketPricePerTokenInBtc =
                      AlwaysMineModeEstimates.MarketPricePerTokenInBtc;

                    resolve({
                      minerStatus,
                      workers,
                      minerStatusCode,
                      currentHashrate,
                      currentHashrateReadable,
                      marketFactorName,
                      rewardInTokensL30D,
                      rentalPercentComplete,
                      expectedRewardFromRental,
                      rewardSoFarVsExpectedTotal,
                      rewardSoFarVsExpectedTotalPercent,
                      rewardSoFarVsExpectedTotal,
                      rewardsStillPending,
                      CostOfRentalInBtc,
                      LiveEstimateQtyOfTokensToBeMined,
                      LiveEstimateOfferPrice,
                      MarketPricePerTokenInBtc,
                    });
                  } else {
                    if (!data)
                      console.log("Something wrong with the api or syntax");
                    let minerStatus = "Mining has started";
                    let minerStatusCode = 2000;
                    let currentHashrate = data.currentHashrate;
                    let currentHashrateReadable =
                      currentHashrate / marketFactor;
                    let rewardInSatsL30D = data.sumrewards[4].reward;
                    let rewardInTokensL30D = rewardInSatsL30D / 1e8;

                    let rewardSoFarVsExpectedTotal =
                      Math.round(
                        (rewardInTokensL30D - expectedRewardFromRental) * 1e2
                      ) / 1e2;
                    let rewardSoFarVsExpectedTotalPercent =
                      rewardSoFarVsExpectedTotal / expectedRewardFromRental;
                    let rewardsStillPending = data.rewards[0].immature;
                    // let rentalPercentComplete = .192; //replace with function that pulls live data
                    let CostOfRentalInBtc = 0.0009592; //replace with function that pulls live data
                    let BittrexWithdrawalFee = 0.0005;
                    let LiveEstimateQtyOfTokensToBeMined =
                      Math.round(
                        (rewardInTokensL30D / rentalPercentComplete) * 1e2
                      ) / 1e2;
                    let LiveEstimateOfferPrice =
                      Math.round(
                        ((CostOfRentalInBtc + BittrexWithdrawalFee) /
                          LiveEstimateQtyOfTokensToBeMined) *
                          1e8
                      ) / 1e8;
                    let MarketPricePerTokenInBtc =
                      AlwaysMineModeEstimates.MarketPricePerTokenInBtc;
                    let workers = data.workersOnline;

                    resolve({
                      minerStatus,
                      workers,
                      minerStatusCode,
                      currentHashrate,
                      currentHashrateReadable,
                      marketFactorName,
                      rewardInTokensL30D,
                      rentalPercentComplete,
                      expectedRewardFromRental,
                      rewardSoFarVsExpectedTotal,
                      rewardSoFarVsExpectedTotalPercent,
                      rewardSoFarVsExpectedTotal,
                      rewardsStillPending,
                      CostOfRentalInBtc,
                      LiveEstimateQtyOfTokensToBeMined,
                      LiveEstimateOfferPrice,
                      MarketPricePerTokenInBtc,
                    });
                  }
                });
              }
            })
            .on("error", (error) => {
              console.log("Error: " + error.message);
              reject("Error: " + error.message);
            });
        });
      }
      let miningRvnOn2MinersResults = await miningrvnon2minersresults();
      let rewardInTokensL30D = await miningRvnOn2MinersResults.rewardInTokensL30D;
      console.log(rewardInTokensL30D);

      async function nicehashrentalresults() {
        return await new Promise((resolve, reject) => {
          let token = UserInput.token;
          console.log(token);
          if ((token = "FLO")) {
            resolve({ token });
          } else
            https
              .get(
                "https://api2.nicehash.com/main/api/v2/hashpower/myOrders/",
                (response) => {
                  // https.get(URL, (response) => {
                  let body = "";
                  response.on("", () => {
                    console.log("Error: " + error.message);
                    reject("Error: " + error.message);
                  });
                  response.on("data", (chunk) => {
                    body += chunk;
                  });
                  response.on("end", () => {
                    let data = JSON.parse(body);
                    if (!data)
                      console.log("Something wrong with the api or syntax");

                    // let currentHashrate = data.currentHashrate
                    // let rewardInSatsL30D = data.sumrewards[4].reward
                    // let rewardInTokensL30D = rewardInSatsL30D / 1e8
                    // let expectedRewardFromRental = Estimates.EstimatedQtyOfTokensToBeMined
                    // let rewardSoFarVsExpectedTotal = rewardInTokensL30D / expectedRewardFromRental
                    // let rewardsStillPending = data.rewards[0].immature
                    // let workerOfflinePrep = data.workers

                    // let PriceUsdPerBtcOnCoinbase =
                    //   Math.round((
                    //     data.data.rates.USD
                    //   )*1e2)/1e2;
                    resolve({ data });
                  });
                }
              )
              .on("error", (error) => {
                console.log("Error: " + error.message);
                reject("Error: " + error.message);
              });
        });
      }

      // let miningRvnOn2MinersResults = await miningrvnon2minersresults()

      let minerStatusCode = miningRvnOn2MinersResults.minerStatusCode;
      // console.log('minerStatusCode', minerStatusCode)
      async function rvnreceivedbyworker() {
        return await new Promise((resolve, reject) => {
          let token = UserInput.token;
          console.log(token);
          if ((token = "FLO")) {
            resolve({ token });
          } else console.log(minerStatusCode);
          let worker = UserInput.worker;
          let endpointbase = "https://main.rvn.explorer.oip.io/api/addr/";
          let URL = endpointbase.concat(worker);
          // console.log('URL',URL)
          https
            .get(URL, (response, reject) => {
              let ErrOr = "explorer";
              // console.log(response.statusCode, ErrOr)
              if (response.statusCode === 400) {
                //no work received yet
                let ErrOr = "explorer";
                // console.log(response.statusCode, ErrOr)
                // let minerStatusCode = miningrvnon2minersresults.minerStatusCode
                let workerStatus = "Worker address invalid, re-check";

                console.log(minerStatusCode);
                let totalReceived = 0;
                let balance = 0;
                let totalSent = 0;
                let unconfirmedBalance = 0;
                let rewardInTokensL30D =
                  MiningRvnOn2MinersResults.rewardInTokensL30D;
                let rewardNotYetReceived =
                  Math.round((rewardInTokensL30D - totalReceived) * 1e8) / 1e8;
                let percentOfMinedRewardReceived =
                  Math.round((totalReceived / rewardInTokensL30D) * 1e2) / 1e2;
                resolve({
                  minerStatusCode,
                  workerStatus,
                  totalReceived,
                  balance,
                  totalSent,
                  unconfirmedBalance,
                  rewardInTokensL30D,
                  rewardNotYetReceived,
                  percentOfMinedRewardReceived,
                });
              } else {
                //work has been received
                let body = "";
                response.on("data", (chunk) => {
                  body += chunk;
                });
                response.on("end", () => {
                  let data = JSON.parse(body);
                  if (!data)
                    console.log("Something wrong with the api or syntax");
                  let workerStatus = "Worker is real";
                  let totalReceived = data.totalReceived;
                  let balance = data.balance;
                  let totalSent = data.totalSent;
                  let unconfirmedBalance = data.unconfirmedBalance;
                  let rewardInTokensL30D =
                    MiningRvnOn2MinersResults.rewardInTokensL30D;
                  let rewardNotYetReceived =
                    Math.round((rewardInTokensL30D - totalReceived) * 1e8) /
                    1e8;
                  let percentOfMinedRewardReceived =
                    Math.round((totalReceived / rewardInTokensL30D) * 1e2) /
                    1e2;
                  resolve({
                    minerStatusCode,
                    workerStatus,
                    totalReceived,
                    balance,
                    totalSent,
                    unconfirmedBalance,
                    rewardInTokensL30D,
                    rewardNotYetReceived,
                    percentOfMinedRewardReceived,
                  });
                });
              }
            })
            .on("error", (error) => {
              console.log("Error: " + error.message);
              reject("Error: " + error.message);
            });
        });
      }

      // let MiningFloOnMlgPoolResults = await miningfloonmlgpoolresults()
      let MiningRvnOn2MinersResults = await miningrvnon2minersresults();
      let rvnReceivedByWorker = await rvnreceivedbyworker();
      // put token conditional HERE idiot lol
      return { MiningRvnOn2MinersResults, rvnReceivedByWorker };
    }

    // response.on('', () => {
    //   let errorMessage = "Miner is too lazy and hasnt started working yet";
    //   let errorCode = 0;
    //   let workers = 0;
    //   let currentHashrate = 0;
    //   let marketFactor = MiningMarketInfo.marketFactor
    //   let marketFactorName = MiningMarketInfo.marketFactorName
    //   let expectedRewardFromRental = AlwaysMineModeEstimates.EstimatedQtyOfTokensToBeMined
    //   let rewardSoFarVsExpectedTotal =
    //   Math.round((
    //     0 - expectedRewardFromRental
    //     )*1e2)/1e2;
    //   console.log("Error: " + errorMessage);
    //   resolve ({workers,currentHashrate,currentHashrateReadable,marketFactorName, expectedRewardFromRental, rewardSoFarVsExpectedTotal,rentalPercentComplete, MarketPricePerTokenInBtc});
    //   reject("Error: " + errorMessage)
    // });

    //let workerMining = workerOfflinePrep
    // let workerOffline = (false.test(workerOfflinePrep))
    // if(workerOfflinePrep !== !1) {
    //   let workerOffline = true
    // }else{
    //   let workerOffline = false

    // }

    // let PriceUsdPerBtcOnCoinbase =
    //   Math.round((
    //     data.data.rates.USD
    //   )*1e2)/1e2;
  })
  .catch((err) => console.log("err", err));

var _default = SpartanBot;
exports.default = _default;
