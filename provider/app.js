'use strict';

/**
 * Service which can be configured to listen for triggers from a provider.
 * The Provider will store, invoke, and POST whisk events appropriately.
 */
const URL = require('url').URL;
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const bluebird = require('bluebird');
const redis = require('redis')
bluebird.promisifyAll(redis.RedisClient.prototype);
const logger = require('./Logger');

const ProviderTriggersManager = require('./lib/triggers_manager.js');
const ProviderHealth = require('./lib/health.js');
const ProviderRAS = require('./lib/ras.js');
const ProviderActivation = require('./lib/active.js');
const constants = require('./lib/constants.js');

// Initialize the Express Application
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.set('port', process.env.PORT || 8080);

const db_env_vars = ['DB_PROTOCOL', 'DB_HOST', 'DB_USERNAME', 'DB_PASSWORD']

for (let env_var of db_env_vars) {
  if (!process.env[env_var]) {
    throw new Error(`Missing ${env_var} environment parameter.`)
  }
}

const dbUrl = process.env.DB_PROTOCOL + '://' + process.env.DB_USERNAME + ':' 
  + process.env.DB_PASSWORD + '@' + process.env.DB_HOST

// This is the database that will store the managed triggers.
const databaseName = process.env.TRIGGERS_DB || constants.DEFAULT_TRIGGERS_DB;

// Optional Configuration Parameters
const redisUrl = process.env.REDIS_URL;

// Optional Configuration Parameters
const monitoringAuth = process.env.MONITORING_AUTH;
const monitoringInterval = process.env.MONITORING_INTERVAL || constants.MONITOR_INTERVAL;

const filterDDName = '_design/' + constants.FILTERS_DESIGN_DOC;
const viewDDName = '_design/' + constants.VIEWS_DESIGN_DOC;

if (!process.env.EVENT_PROVIDER) {
  throw new Error('Missing EVENT_PROVIDER environment parameter.')
}

const EventProvider = require(process.env.EVENT_PROVIDER)

// Create the Provider Server
const server = http.createServer(app);
server.listen(app.get('port'), function() {
    logger.info('server.listen', 'Express server listening on port ' + app.get('port'));
});

function createDatabase() {
    const method = 'createDatabase';
    logger.info(method, 'creating the trigger database', dbUrl);

    const nano = require('nano')(dbUrl)

    if (nano !== null) {
        return new Promise(function (resolve, reject) {
            nano.db.create(databaseName, function (err, body) {
                if (!err) {
                    logger.info(method, 'created trigger database:', databaseName);
                }
                else if (err.statusCode !== 412) {
                    logger.info(method, 'failed to create trigger database:', databaseName, err);
                }

                const viewDD = {
                    views: {
                        triggers_by_worker: {
                            map: function (doc) {
                                if (doc.maxTriggers && (!doc.status || doc.status.active === true)) {
                                    emit(doc.worker || 'worker0', 1);
                                }
                            }.toString(),
                            reduce: '_count'
                        }
                    }
                };

                createDesignDoc(nano.db.use(databaseName), viewDDName, viewDD)
                .then(db => {
                    const filterDD = {
                        filters: {
                            triggers_by_worker:
                                function (doc, req) {
                                    return doc.maxTriggers && ((!doc.worker && req.query.worker === 'worker0') ||
                                            (doc.worker === req.query.worker));
                                }.toString()
                        }
                    };
                    return createDesignDoc(db, filterDDName, filterDD);
                })
                .then(db => {
                    if (monitoringAuth) {
                        const filterDD = {
                            filters: {
                                canary_docs:
                                    function (doc, req) {
                                        return doc.isCanaryDoc && doc.host === req.query.host;
                                    }.toString()
                            }
                        };
                        return createDesignDoc(db, '_design/' + constants.MONITOR_DESIGN_DOC, filterDD);
                    }
                    else {
                        return Promise.resolve(db);
                    }
                })
                .then((db) => {
                    resolve(db);
                })
                .catch(err => {
                    reject(err);
                });

            });
        });
    }
    else {
        Promise.reject('pluggable feed provider did not get created.  check db URL: ' + dbUrl);
    }
}

function createDesignDoc(db, ddName, designDoc) {
    const method = 'createDesignDoc';

    return new Promise(function(resolve, reject) {

        db.get(ddName, function (error, body) {
            if (error) {
                //new design doc
                db.insert(designDoc, ddName, function (error, body) {
                    if (error && error.statusCode !== 409) {
                        logger.error(method, error);
                        reject('design doc could not be created: ' + error);
                    }
                    else {
                        resolve(db);
                    }
                });
            }
            else {
                resolve(db);
            }
        });
    });
}

function createRedisClient() {
    const method = 'createRedisClient';

    return new Promise(function(resolve, reject) {
        if (redisUrl) {
            let client;
            if (redisUrl.startsWith('rediss://')) {
                // If this is a rediss: connection, we have some other steps.
                client = redis.createClient(redisUrl, {
                    tls: { servername: new URL(redisUrl).hostname }
                });
                // This will, with node-redis 2.8, emit an error:
                // "node_redis: WARNING: You passed "rediss" as protocol instead of the "redis" protocol!"
                // This is a bogus message and should be fixed in a later release of the package.
            } else {
                client = redis.createClient(redisUrl);
            }

            client.on('connect', function () {
                resolve(client);
            });

            client.on('error', function (err) {
                logger.error(method, 'Error connecting to redis', err);
                reject(err);
            });
        }
        else {
            resolve();
        }
    });
}

// Initialize the Provider Server
function init(server, EventProvider) {
    const method = 'init';
    let database;
    let providerTriggersManager;

    if (server !== null) {
        const address = server.address();
        if (address === null) {
            logger.error(method, 'Error initializing server. Perhaps port is already in use.');
            process.exit(-1);
        }
    }

    createDatabase()
    .then(db => {
        database = db;
        return createRedisClient();
    })
    .then(client => {
        providerTriggersManager = new ProviderTriggersManager(logger, database, EventProvider, client);
        return providerTriggersManager.initRedis();
    })
    .then(() => {
        const providerRAS = new ProviderRAS();
        const providerHealth = new ProviderHealth(logger, providerTriggersManager);
        const providerActivation = new ProviderActivation(logger, providerTriggersManager);

        // RAS Endpoint
        app.get(providerRAS.endPoint, providerRAS.ras);

        // Health Endpoint
        app.get(providerHealth.endPoint, providerTriggersManager.authorize, providerHealth.health);

        // Activation Endpoint
        app.get(providerActivation.endPoint, providerTriggersManager.authorize, providerActivation.active);

        providerTriggersManager.initAllTriggers();

        if (monitoringAuth) {
            setInterval(function () {
                providerHealth.monitor(monitoringAuth, monitoringInterval);
            }, monitoringInterval);
        }
    })
    .catch(err => {
        logger.error(method, 'an error occurred creating database:', err);
    });
}

init(server, EventProvider);
