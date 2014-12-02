var logging = require('minilog')('radar:presence_store');

function PresenceStore(scope) {
  this.scope = scope;
  this.map = {};
  this.cache = {};
  this.clientUserMap = {};
  this.userTypes = {};
}

require('util').inherits(PresenceStore, require('events').EventEmitter);

//cache the client data without adding
PresenceStore.prototype.cacheAdd = function(clientId, data) {
  this.cache[clientId] = data;
};

PresenceStore.prototype.cacheRemove = function(clientId) {
  var val = this.cache[clientId];
  delete this.cache[clientId];
  return val;
};

PresenceStore.prototype.add = function(clientId, userId, userType, data) {
  var store = this,
      events = [];
  logging.debug('#presence - store.add', userId, clientId, data, this.scope);
  this.cacheRemove(clientId);

  if(!this.map[userId]) {
    events.push('user_added');
    this.map[userId] = {};
    this.userTypes[userId] = userType;
  }

  if(!this.map[userId][clientId]) {
    events.push('client_added');
    this.map[userId][clientId] = data;
    this.clientUserMap[clientId] = userId;
  }

  events.forEach(function(ev) {
    logging.debug('#presence - store.emit', ev, data, store.scope);
    store.emit(ev, data);
  });
};

PresenceStore.prototype.remove = function(clientId, userId, data) {
  var store = this,
      events = [];
  logging.debug('#presence - store.remove', userId, clientId, data, this.scope);
  this.cacheRemove(clientId);

  if(!this.map[userId] || !this.map[userId][clientId]) {
    return; //inexistant, return
  }

  events.push('client_removed');
  delete this.map[userId][clientId];
  delete this.clientUserMap[clientId];

  //Empty user
  if(Object.keys(this.map[userId]).length === 0) {
    events.push('user_removed');
    delete this.map[userId];
    delete this.userTypes[userId];
  }

  events.forEach(function(ev) {
    logging.debug('#presence - store.emit', ev, data, store.scope);
    store.emit(ev, data);
  });
};

PresenceStore.prototype.removeClient = function(clientId, data) {
  var userId = this.clientUserMap[clientId];
  this.cacheRemove(clientId);
  if(!userId) {
    logging.warn('#presence - store.removeClient: cannot find data for', clientId, this.scope);
    return; //inexistant, return
  }
  logging.debug('#presence - store.removeClient', userId, clientId, data, this.scope);
  delete this.map[userId][clientId];
  delete this.clientUserMap[clientId];
  logging.debug('#presence - store.emit', 'client_removed', data, this.scope);
  this.emit('client_removed', data);
};

PresenceStore.prototype.removeUserIfEmpty = function(userId, data) {
  if(this.userExists(userId) && this.userEmpty(userId)) {
    logging.debug('#presence - store.removeUserIfEmpty', userId, data, this.scope);
    delete this.map[userId];
    delete this.userTypes[userId];
    logging.debug('#presence - store.emit', 'user_removed', data, this.scope);
    this.emit('user_removed', data);
  }
};

PresenceStore.prototype.userOf = function(clientId) {
  return this.clientUserMap[clientId];
};

PresenceStore.prototype.get = function(clientId, userId) {
  return (this.map[userId] && this.map[userId][clientId]);
};

PresenceStore.prototype.users = function() {
  return Object.keys(this.map);
};

PresenceStore.prototype.clients = function(userId) {
  return ((this.map[userId] && Object.keys(this.map[userId])) || []);
};

PresenceStore.prototype.forEachClient = function(callback) {
  var store = this;
  this.users().forEach(function(userId) {
    store.clients(userId).forEach(function(clientId) {
      if(callback) callback(userId, clientId, store.get(clientId, userId));
    });
  });
};

PresenceStore.prototype.userEmpty = function(userId) {
  if(this.map[userId] &&
     Object.keys(this.map[userId]).length === 0) {
    return true;
  }
  return false;
};

PresenceStore.prototype.userTypeOf = function(userId) {
  return this.userTypes[userId];
};

PresenceStore.prototype.userExists = function(userId) {
  return !!this.map[userId];
};


// The following code replaces a tight-loop of invocations to callback() with a
// chained set of invocations to callback(), with each invocation added to the
// event-loop with the help of setImmediate().


// A costly step, which we do only when a server is determined to have gone down.
// Or when a server has no presence resources left (also rare).
PresenceStore.prototype.clientsForSentry = function (sentry, callback) {
  this._chainInit();
  this._chainClientsForSentry(sentry, true, callback);
};

PresenceStore.prototype._chainInit = function () {
  this.uIds = Object.keys(this.map) || []; // keys of map, which are the userIds
  this.cIds = [];               // current clientId keys of map[uId]
  this.uIndex = -1;             // index of current userId key in map
  this.cIndex = -1;             // index of current clientId key in map[userId]
  this.uId = undefined;         // current userId key in map
  this.cId = undefined;         // current clientId key in map[uId]
};


PresenceStore.prototype._uIdNextGet = function () {
  if (++this.uIndex < this.uIds.length) {
    return this.uIds[this.uIndex];
  }
  return undefined;
};


PresenceStore.prototype._cIdNextGet = function () {
  if (-1 == this.cIndex) {
    this.cIds = Object.keys(this.map[this.uId]) || [];
  }

  if (++this.cIndex < this.cIds.length) {
    return this.cIds[this.cIndex];
  }
  return undefined;
};


PresenceStore.prototype._chainClientsForSentry = function(sentry, uIncr, callback) {
  if (uIncr) {
    this.uId = this._uIdNextGet();
    uIncr = false;
  }

  if (!this.uId) {
      return;
  }

  this.cId = this._cIdNextGet();

  if (!this.cId) {
    uIncr = true;
    this.cIndex = -1;
  }
  else {
    var data = this.map[this.uId][this.cId];
    if (data && data.sentry == sentry) {
      if (callback) callback(this.cId);
    }
  }

  setImmediate(this._chainClientsForSentry.bind(this), sentry, uIncr, callback);
};


module.exports = PresenceStore;
