# OpenWhisk Pluggable Event Provider

This projects contains a pluggable trigger feed event provider for Apache OpenWhisk. It has a plugin architecture that allows event sources to be integrated without having to re-write or maintain generic boilerplate. Event sources just need to implement a simple interface, exposed as a Node.js module.

This event provider handles all the trigger registration, monitoring and management services, leaving the event source plugin to handle listening to the external event source and firing events. It based off the Cloudant trigger feed package.

## Plugin Interface

Plugins must expose a Node.js module with the following methods. 

```javascript
// initialise plugin instance (must be a JS constructor)
module.exports = function (trigger_manager, logger) {
    // register new trigger feed
    const add = async (trigger_id, trigger_params) => {}
    // remove existing trigger feed
    const remove = async trigger_id => {}

   return { add, remove }
}

// valiate feed parameters
module.exports.validate = async trigger_params => {}
```

### initialisation

Upon starting the Pluggable Event Provider, the event provider plugin (provided by an environment variable - see below) will be `require()`'d into the runtime. An instance of the plugin will be created from the JS constructor returned through the module export.

#### trigger manager

The `trigger_manager` parameter exposes two async functions:

- ` fireTrigger(id, params)` - fire trigger given by id passed into `add` method with event parameters.
- `disableTrigger(id, status_code, message)` - disable trigger feed due to external event source issues.

Both functions handle the retry logic and error handling for those operations. These should be used by the event provider plugin to fire triggers when events arrive from external sources and then disable triggers due to external event source issues.

### adding triggers

When a new trigger is added to the trigger feeds' database, the details will be passed to the `add` method. Trigger parameters will be used to set up listening to the external event source. When external events occur, the `trigger_manager` can be use to automatically fire triggers.

### removing triggers

When users delete triggers with feeds, the trigger will be removed from the database. This will lead to the `remove` method being called. Plugins should stop listening to messages for this event source.

### validate

This static function on the plugin constructor is used to validate incoming trigger feed parameters for correctness, e.g. checking authentication credentials for an event source. It is passed the trigger parameters from the user.

It must return a resolved Promise with the parameters that are to be stored in the Trigger DB alongside the trigger information. If there is an issue with the feed parameter, it should return a rejected Promise.

### errors

Upon unrecoverable errors from the external event source, e.g. authentication issues, the plugin should call the `disableTrigger` function on the `trigger_manager`. This will lead to the trigger being disabled in the external triggers database, which will then call the `remove` method in the plugin. Plugins should not call their own `remove` method directly.

## Running The Provider + Plugin

This pluggable provider uses an environment variable (`EVENT_PROVIDER`) to dynamically define the Node.js module name for the event provider plugin.

### npm link

Use `npm link` to expose the local event provider's plugin directory as an installable NPM module.

```
cd ~/code/my-event-provider
npm link 
```

### environment variables

Before starting the provider application, define the following environment variables. 

- `EVENT_PROVIDER` - NPM module name for event provider plugin.
- `DB_URL` - Trigger DB Cloudant URL.
- `DB_PREFIX` - Trigger DB table prefix.
- `ROUTER_HOST` - OpenWhisk platform hostname.

### running feed provider

```
$ cd provider
$ npm start
```

## Installing Feed Provider Actions

Once the provider is running, install the feed provider actions by running the following command: 

```
./installCatalog.sh <authkey> <edgehost> <dburl> <dbprefix> <apihost> <namespace>
```

- `<authkey>` - OpenWhisk authentication key.
- `<edgehost>` - OpenWhisk hostname for installing actions.
- `<dburl>` - Trigger DB Cloudant URL.
- `<dbname>`- Trigger DB table name.
- `<apihost>`  - OpenWhisk hostname for firing triggers.
- `<namespace>` - OpenWhisk namespace to install provider action packages 

### actions

Running the script will result in the following actions being installed.

- `/<NAMESPACE>/<EVENT_PROVIDER>/changes` 
- `/<NAMESPACE>/<EVENT_PROVIDER>-web/changesWebAction` 

The `changes` action is used to handle the incoming [trigger feed requests](https://github.com/apache/incubator-openwhisk/blob/master/docs/feeds.md). Trigger feeds events are passed to the `changesWebAction` which interfaces with the Trigger DB table. Changes to this table are listened to by the event provider, which calls the plugin to handle adding and removing trigger event sources.