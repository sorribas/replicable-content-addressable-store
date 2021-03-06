var scuttleup = require('scuttleup');
var crypto = require('crypto');
var events = require('events');
var subleveldown = require('subleveldown');
var pump = require('pump');
var through = require('through2');

var cas = function(db, opts) {
  if (!opts) opts = {};

  var logopts = opts.id ? {id: opts.id} : {};
  var log = scuttleup(subleveldown(db, 'log'), logopts);
  var store = subleveldown(db, 'store');
  var that = new events.EventEmitter();
  var cbs = {};
  var head = 0;

  var changeStream = through.obj(function(dta, enc, cb) {
    var onbatch = function(err) {
      if (err) that.emit('error', err);
      if (dta.peer === log.id) {
        head = dta.seq;
        if (cbs[dta.seq]) {
          cbs[dta.seq]();
          delete cbs[dta.seq];
        }
      }
      cb();
    };

    var onget = function(err, heads) {
      if (err && !err.notFound) return that.emit('error', err);
      heads = heads? JSON.parse(heads) : {};
      heads[dta.peer] = {peer: dta.peer, seq: dta.seq};
      store.batch([
        JSON.parse(dta.entry.toString()),
        {type: 'put', key: 'heads', value: JSON.stringify(heads)}
      ], onbatch);
    };

    store.get('heads', onget);
  });

  store.get('heads', function(err, heads) {
    if (err && !err.notFound) return that.emit('error', err);
    if (!heads) return pump(log.createReadStream({live: true, since: hds}), changeStream);
    heads = JSON.parse(heads);
    var hds = Object.keys(heads).map(function(key) {
      return heads[key];
    });
    pump(log.createReadStream({live: true, since: hds}), changeStream);
  });

  that.syncStream = function() {
    return log.createReplicationStream();
  };

  that.put = function(content, cb) {
    cb = cb || function() {};
    var key = crypto.createHash('sha256').update(content).digest('hex');
    log.append(JSON.stringify({type:'put', key: key, value: content}), function(err, change) {
      if (err) return cb(err);
      if (head >= change.seq) return cb(null, key);
      cbs[change.seq] = function() { cb(null, key) };
    });
  };

  that.del = function(key, cb) {
    log.append(JSON.stringify({type:'del', key: key}), function(err, change) {
      if (err) return cb(err);
      if (head >= change.seq) return cb();
      cbs[change.seq] = function() { cb() };
    });
  };

  that.get = function(key, cb) {
    store.get(key, cb);
  };

  that.createValueStream = function(opts) {
    return store.createValueStream(opts);
  };

  that.createKeyStream = function(opts) {
    return store.createKeyStream(opts);
  };

  that.createReadStream = function(opts) {
    return store.createReadStream(opts);
  };

  return that;
};

module.exports = cas;
