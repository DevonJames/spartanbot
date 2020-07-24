"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true,
});
exports.default = void 0;

var _RentalProvider = _interopRequireDefault(require("./RentalProvider"));

var _nicehashApi = _interopRequireDefault(require("nicehash-api"));

var _util = require("../util");

var _constants = require("../constants");

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

class NiceHashProvider extends _RentalProvider.default {
  constructor(settings) {
    super(settings);
    this.locale = settings.locale;
    this.api_key = settings.api_key || settings.key;
    this.api_secret = settings.api_secret;
    this.api_id = settings.api_id || settings.id;
    this.api = new _nicehashApi.default(settings);
  }
  /**
   * Get the "type" of this RentalProvider
   * @return {String} Returns "NiceHash"
   * @static
   */

  static getType() {
    return "NiceHash";
  }
  /**
   * Non static method to get type
   * @return {String} returns "NiceHash"
   */

  getInternalType() {
    return "NiceHash";
  }
  /**
   * Test Authorization
   * @async
   * @returns {Promise<Boolean>}
   */

  async _testAuthorization() {
    try {
      return await this.api.testAuthorization();
    } catch (err) {
      throw new Error("Authorization failed: ".concat(err));
    }
  }
  /**
   * Get Balance
   * @async
   * @returns {Promise<Number>}
   */

  async _getBalance(currency) {
    try {
      return await this.api.getBalance(currency);
    } catch (err) {
      throw new Error("Failed to get balance: ".concat(err));
    }
  }
  /**
   * Create Pool
   * @param {string|number} options.algo - Algorithm name or ID
   * @param {string} options.pool_host - Pool hostname or IP;
   * @param {string} options.pool_port - Pool port
   * @param {string} options.pool_user - Pool username
   * @param {string} options.pool_pass - Pool password
   * @param {string} options.name - Name to identify the pool with
   * @param {number} [options.id] - Local ID (an arbitrary id you can give it for more control)
   * @param {string|number} [options.location=0] - 0 for Europe (NiceHash), 1 for USA (WestHash);
   * @return {Object}
   */

  async _getOrders(algo) {
    console.log(
      "properties of api are: " + Object.getOwnPropertyNames(this.api)
    );
    try {
      let answer = await this.api.getOrders(algo);
      return answer;
    } catch (err) {
      throw new Error(" failed to get orders: \n".concat(err));
    }
  }

  async _createPool(options) {
    if (!options.host || !options.port || !options.user || !options.pass) {
      return {
        success: false,
        message: "must provide all of the following: host, port, user, pass",
      };
    }

    let pool = _objectSpread({}, options, {
      market: this.getInternalType(),
      providerUID: this.getUID(),
    });

    try {
      let res = await this.api.createOrEditPool(options);

      if (res.success) {
        pool = res;
      } else {
        res.message =
          "User input is more than likely wrong. Check console for error.";
        pool = res;
      }
    } catch (err) {
      throw new Error("Failed to create pool: ".concat(err));
    }

    this._addPools(pool);

    this._setActivePool(pool.id);

    return pool;
  }
  /**
   * Delete pool from local variable, this.pools
   * @param id
   * @returns {Promise<Object>}
   * @private
   */

  async _deletePool(id) {
    for (let pool in this.pools) {
      if (this.pools[pool].id === id) {
        this.pools.splice(pool, 1);
      }
    }

    for (let pool of this.pools) {
      if (pool.id === id) {
        return {
          success: false,
          message: "failed to remove pool with .splice",
        };
      }
    }

    return {
      success: true,
      message: "Pool: ".concat(id, " removed."),
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
   * @async
   * @returns {Promise<Object>}
   */

  async updatePool(id, options) {
    for (let pool of this.pools) {
      if (pool.id === id) {
        for (let opt in pool) {
          switch (opt) {
            case "algorithm":
              options.type = options.type || pool[opt];
              break;

            case "name":
              options.name = options.name || pool[opt];
              break;

            case "stratumHostname":
              options.host = options.host || pool[opt];
              break;

            case "stratumPort":
              options.port = options.port || pool[opt];
              break;

            case "username":
              options.user = options.user || pool[opt];
              break;

            case "password":
              options.pass = options.pass || pool[opt];
              break;

            case "notes":
              options.notes = options.notes || "";
              break;
          }
        }
      }
    }

    const res = await this.api.createOrEditPool(options);
    this.pools.push(res);
    return {
      success: true,
      data: {
        id,
        success: true,
        message: "Updated",
      },
    };
  }
  /**
   * Internal function to get Pools
   * @async
   * @private
   * @return {Array.<Object>}
   */

  async _getPools() {
    try {
      let pool = await this.api.getPools();
      return pool.list;
    } catch (e) {
      console.log("e:", e.error);
      return e.error;
    }
  }

  _addPools(pools) {
    if (Array.isArray(pools)) {
      for (let pool of pools) {
        let match = false;

        for (let p of this.pools) {
          if (p.id === pool.id) match = true;
        }

        if (!match) this.pools.push(pools);
      }
    } else {
      let match = false;

      for (let p of this.pools) {
        if (p.id === pools.id) match = true;
      }

      if (!match) this.pools.push(pools);
    }
  }
  /**
   * Set pool to active
   * poolid
   * @private
   */

  _setActivePool(poolid) {
    this.activePool = poolid;
  }
  /**
   * return active pool
   * @private
   */

  _returnActivePool() {
    return this.activePool;
  }

  async getDuration(settings) {
    return await this.api.getDuration(settings);
  }

  async getStandardPrice(algo) {
    return await this.api.getStandardPrice(algo);
  }

  async getFixedPrice(options) {
    return await this.api.getFixedPrice(options);
  }
  /**
   * returns stats current (orders) for EU & USA market
   * @private
   */

  async getOrderBook(algo) {
    return await this.api.getOrderBook(algo);
  } // Gets hit from async rentPreprocess(options) in AutoRenter.js

  async preprocessRent(options) {
    let status = {
      status: _constants.NORMAL,
    };
    let balance;

    try {
      let balance_Object = await this._getBalance("BTC");
      balance = Number(balance_Object);
    } catch (err) {
      status.status = _constants.ERROR;
      return {
        success: false,
        message: "failed to get balance",
        status,
      };
    }

    let duration;

    try {
      let res = await this.getDuration({
        amount: options.amount,
        limit: options.limit.toFixed(8),
        price: options.price,
        type: options.type.toUpperCase(),
      });
      let numberToString = res.estimateDurationInSeconds / 60 / 60 + "";
      duration = numberToString.replace(/(.*\.\d{2})(.+)/, "$1"); // Javascripts toFixed() is unreliable and rounds and we don't need that!
    } catch (err) {
      status.status = _constants.ERROR;
      return {
        success: false,
        message: "failed to get duration",
        status,
      };
    }

    let limitToString = options.limit + "";
    let limit = limitToString.replace(/(.*\.\d{2})(.+)/, "$1"); // Javascripts toFixed() is unreliable and rounds and we don't need that!

    let totalHashes;
    let label;

    if (options.displayMarketFactor === "GH") {
      totalHashes = options.limit;
      label = "Total Gigahashes";
    } else {
      totalHashes = options.limit;
      label = "Total Terahashes";
    }

    const hashrateTH = options.limit;
    const minimumAmount = 0.005;
    const minimumLimit = 0.01;

    if (balance < minimumAmount || hashrateTH < minimumLimit) {
      status.status = _constants.ERROR;
      let message;

      if (balance < minimumAmount) {
        message = "Balance must be >= 0.005";
        status.type = _constants.LOW_BALANCE;
      }

      if (hashrateTH < minimumLimit) {
        message = "Hashrate/limit must be >= 0.01 TH (10,000 MH)";
        status.type = _constants.LOW_LIMIT;
      }

      return {
        success: false,
        message,
        status,
        duration: duration,
        type: options.type,
        amount: options.amount,
        limit: limit,
        price: options.price,
        balance,
        provider: this,
        algorithm: options.algorithm,
        marketFactor: options.marketFactor,
        displayMarketFactor: options.displayMarketFactor,
        totalHashes,
        label,
      };
    } //get price, amount, hash

    let marketPrice;

    try {
      let stats = await this.api.getCurrentGlobalStats24h();

      for (let stat of stats) {
        if (stat.algo === "Scrypt") {
          marketPrice = stat.price;
          break;
        }
      }
    } catch (err) {
      status.status = _constants.ERROR;
      status.type = "HTML_ERROR";
      status.error = err;
      status.message = "Failed to get current global nice hash stats";
    }

    status.status = _constants.WARNING;
    status.type = _constants.CUTOFF;
    status.message = "Algorithm: ".concat(options.algorithm);
    status.totalDuration = duration;
    status.cost = options.amount;
    return {
      market: "NiceHash",
      status,
      totalHashes,
      label,
      duration: duration,
      type: options.type,
      amount: options.amount,
      limit: limit,
      price: options.price,
      balance,
      algorithm: options.algorithm,
      marketFactor: options.marketFactor,
      displayMarketFactor: options.displayMarketFactor,
      query: {
        hashrate_found: options.limit,
        cost_found: options.amount,
        duration: duration,
      },
      uid: this.getUID(),
      provider: this,
    };
  }
  /**
   * Create new order. Only standard orders can be created with use of API. Gets passed a badge by RentalProvider
   * @param {Object} options - The Options for the rental operation
   * @param {string|number} options.amount - Pay amount in BTC;
   * @param {string|number} options.price - Price in BTC/GH/day or BTC/TH/day;
   * @param {string|number} [options.limit=0.01] - Speed limit in GH/s or TH/s (0 for no limit);
   * @param {string|number} [options.algo='scrypt'] - Algorithm name or ID
   * @param {string|number} [options.location=1] - 0 for Europe (NiceHash), 1 for USA (WestHash);
   * @param {string} [options.pool_host] - Pool hostname or IP;
   * @param {string} [options.pool_port] - Pool port
   * @param {string} [options.pool_user] - Pool username
   * @param {string} [options.pool_pass] - Pool password
   * @param {string|number} [options.code] - This parameter is optional. You have to provide it if you have 2FA enabled. You can use NiceHash2FA Java application to generate codes.
   * @async
   * @returns {Promise<Object>}
   */
  //Gets hit from RentalProvider.js rent()

  async _rent(options) {
    if (!this.api_key || !this.api_id)
      throw new Error("Must provide api key and api id on initialize");
    if (options.amount < 0.005)
      throw new Error("The minimum amount to pay is 0.005 BTC");

    if (options.limit && options.limit < 0.01) {
      throw new Error("The minimum limit is 0.01");
    }

    if (!this.returnPools()) {
      return {
        success: false,
        message: "No pool found",
        status: _constants.ERROR,
      };
    }

    if (!this._returnActivePool()) {
      return {
        success: false,
        message: "No active pool set",
        status: _constants.ERROR,
      };
    }

    let poolID = this._returnActivePool();

    let _pool = {};

    for (let pool of this.pools) {
      if (pool.id === poolID) _pool = pool;
    }

    options.algorithm = options.algorithm;
    options.limit = options.limit || "0.01";
    options.location = options.location || "1";
    let rentOptions = {};

    for (let opt in options) {
      rentOptions[opt] = options[opt];
    }

    rentOptions = _objectSpread({}, rentOptions, {}, _pool);
    let res;

    try {
      res = await this.api.createOrder(rentOptions);
    } catch (err) {
      return {
        success: false,
        message: "Failed to create NiceHash order",
        error: err,
        status: _constants.ERROR,
      };
    }

    let rentalId;
    let success;

    if (res.status.code === "ACTIVE" || res.status.code === "COMPLETED") {
      success = true;
      rentalId = res.id;
    } else {
      success = false;
    }

    return {
      market: "NiceHash",
      CostOfRentalBtc: res.payedAmount,
      success,
      amount: options.amount,
      limit: options.limit,
      price: options.price,
      duration: options.duration,
      status: options.status,
      res,
      rentalId,
      cutoff: options.cutoff,
      uid: this.getUID(),
    };
  }
  /**
   * Cancel NiceHash rental
   * @param {string|number} id - the id of the order you wish to cancel
   * @param {string|number} [location=1] - 0 for Europe, 1 for AMERICA
   * @param {string|number} [algo='scrypt'] - the algorithm the rental is running
   * @private
   * @async
   * @returns {Promise<Object>}
   */

  async _cancelRental(id, location, algo) {
    let res;

    try {
      res = await this.api.removeOrder(id);
    } catch (err) {
      return {
        success: false,
        error: err,
        errorType: "NETWORK",
        id,
      };
    }

    if (res.error) {
      return {
        success: false,
        error: res.error,
        errorType: "NICEHASH",
        id,
      };
    } else {
      return {
        success: true,
        data: res,
        id,
      };
    }
  }

  async getDepositAddresses(currency) {
    return await this.api.getDepositAddresses(currency);
  }

  async getWithdrawalAddresses(currency) {
    return await this.api.getWithdrawalAddresses(currency);
  }
}

var _default = NiceHashProvider;
exports.default = _default;
