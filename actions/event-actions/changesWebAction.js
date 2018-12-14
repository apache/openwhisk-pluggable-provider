const moment = require('moment');
const common = require('./lib/common');
const Database = require('./lib/Database');

function main(params) {
    const EventProvider = require(params.EVENT_PROVIDER)

    if (!params.triggerName) {
        return common.sendError(400, 'no trigger name parameter was provided');
    }

    var triggerParts = common.parseQName(params.triggerName);
    var triggerData = {
        apikey: params.authKey,
        name: triggerParts.name,
        namespace: triggerParts.namespace,
        additionalData: common.constructObject(params.additionalData),
    };
    var triggerID = `:${triggerParts.namespace}:${triggerParts.name}`;

    var workers = params.workers instanceof Array ? params.workers : [];
    const db = new Database(params.DB_URL, params.DB_NAME);

    if (params.__ow_method === "post") {
        return new Promise(function (resolve, reject) {
          const newTrigger = {
            id: triggerID,
            apikey: triggerData.apikey,
            maxTriggers: -1,
            status: {
              'active': true,
              'dateChanged': Date.now()
            }
          };

          common.verifyTriggerAuth(triggerData, false)
            .then(() => EventProvider.validate(params))
            .catch(err => {
              return reject(common.sendError(400, `Feed parameter validation failed`, err.message));
            })
            .then(validParams => {
                Object.assign(newTrigger, validParams)
            })
            .then(() => db.getWorkerID(workers))
            .then((worker) => {
                console.log('trigger will be assigned to worker ' + worker);
                newTrigger.worker = worker;
                return db.createTrigger(triggerID, newTrigger);
            })
            .then(() => resolve(common.sendResponse()))
            .catch(reject)
        });

    }
    else if (params.__ow_method === "get") {
        return new Promise(function (resolve, reject) {
            common.verifyTriggerAuth(triggerData, false)
            .then(() => db.getTrigger(triggerID))
            .then(doc => {
                const ns_name = doc.id.split(':')

                const config = Object.assign({
                  namespace: ns_name[0],
                  name: ns_name[1],
                }, doc)

                const remove_params = ['id', 'status', 'apikey']
                for (let remove of remove_params) {
                  delete config[remove]
                }

                const body = { config, status: doc.status }

                body.status.dateChanged = moment(doc.status.dateChanged).utc().valueOf(),
                body.status.dateChangedISO = moment(doc.status.dateChanged).utc().format(),

                resolve(common.sendResponse(200, body))
            })
            .catch(reject)
        });
    }
    // HOW TO UPDATE?
    else if (params.__ow_method === "put") {

        return new Promise(function (resolve, reject) {
            var updatedParams = {};

            common.verifyTriggerAuth(triggerData, false)
            .then(() => EventProvider.validate(params))
            .catch(err => {
              return reject(common.sendError(400, `Feed parameter validation failed`, err.message));
            })
            .then(validParams => {
                Object.assign(updatedParams, validParams)
            })
            .then(() => db.getTrigger(triggerID))
            .then(trigger => {
                if (trigger.status && trigger.status.active === false) {
                    return reject(common.sendError(400, `${params.triggerName} cannot be updated because it is disabled`));
                }
                return db.disableTrigger(triggerID, trigger, 0, 'updating');
            })
            .then(triggerID => db.getTrigger(triggerID))
            .then(trigger => db.updateTrigger(triggerID, trigger, updatedParams, 0))
            .then(() => resolve(common.sendResponse()))
            .catch(reject) 
        });
    }
    else if (params.__ow_method === "delete") {

        return new Promise(function (resolve, reject) {
            common.verifyTriggerAuth(triggerData, true)
            .then(() => db.getTrigger(triggerID))
            .then(trigger => db.disableTrigger(triggerID, trigger, 0, 'deleting'))
            .then(triggerID => db.deleteTrigger(triggerID, 0))
            .then(() => resolve(common.sendResponse()))
            .catch(reject) 
        });
    }
    else {
        return common.sendError(400, 'unsupported lifecycleEvent');
    }
}

exports.main = main;
