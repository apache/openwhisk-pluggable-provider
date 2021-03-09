<!--
#
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
-->

# Apache OpenWhisk Pluggable Event Provider

This project contains a pluggable trigger feed event provider for Apache OpenWhisk. It has a plugin architecture that allows event sources to be integrated without having to re-write or maintain generic boilerplate. Event sources just need to implement a simple interface, exposed as a Node.js module.

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

- ` fireTrigger(id, params)` - fire trigger given by the id passed into `add` method with event parameters.
- `disableTrigger(id, status_code, message)` - disable trigger feed due to external event source issues.

Both functions handle the retry logic and error handling for those operations. These should be used by the event provider plugin to fire triggers when events arrive from external sources and then disable triggers due to external event source issues.

### adding triggers

When a new trigger is added to the trigger feeds' database, the details will be passed to the `add` method. Trigger parameters will be used to set up listening to the external event source. When external events occur, the `trigger_manager` can be used to automatically fire triggers.

### removing triggers

When users delete triggers with feeds, the trigger will be removed from the database. This will lead to the `remove` method being called. Plugins should stop listening to messages for this event source.

### validate

This static function on the plugin constructor is used to validate incoming trigger feed parameters for correctness, e.g. checking authentication credentials for an event source. It is passed the trigger parameters from the user.

It must return a resolved Promise with the parameters that are to be stored in the Trigger DB alongside the trigger information. If there is an issue with the feed parameter, it should return a rejected Promise.

### errors

Upon unrecoverable errors from the external event source, e.g. authentication issues, the plugin should call the `disableTrigger` function on the `trigger_manager`. This will lead to the trigger being disabled in the external triggers database, which will then call the `remove` method in the plugin. Plugins should not call their own `remove` method directly.

## Running The Provider + Plugin

This pluggable provider uses an environment variable (`EVENT_PROVIDER`) to dynamically define the Node.js module name for the event provider plugin.

### npm install

Use `npm install` to install the event provider plugin from NPM before starting the provider.

```
cd provider
npm install <EVENT_PROVIDER_NPM_PACKAGE>
```

### environment variables

Before starting the provider application, define the following environment variables.

- `EVENT_PROVIDER` - NPM module name for event provider plugin.
- `DB_URL` - Trigger DB Cloudant URL.
- `TRIGGERS_DB` - Trigger DB table name.
- `ROUTER_HOST` - OpenWhisk platform hostname.
- (Optional) `LOG_LEVEL` - Set logging level (defaults to `info`)

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

*The `WSK_CLI` environment variable must refer to the compiled instance of the [Apache OpenWhisk CLI](https://github.com/apache/incubator-openwhisk-cli).*

### optional parameters

If the `EVENT_PROVIDER_LIB` environment variable is set, this will be used as the explicit location to install the event provider library from. This can be used to install from a non-published version of the library, i.e. on the filesystem or a Github repository. If this value is not set, the library will be installed from NPM using the `EVENT_PROVIDER` library name.

### actions

Running the script will result in the following actions being installed.

- `/<NAMESPACE>/<EVENT_PROVIDER>/changes`
- `/<NAMESPACE>/<EVENT_PROVIDER>-web/changesWebAction`

The `changes` action is used to handle the incoming [trigger feed requests](https://github.com/apache/incubator-openwhisk/blob/master/docs/feeds.md). Trigger feeds events are passed to the `changesWebAction` which interfaces with the Trigger DB table. Changes to this table are listened to by the event provider, which calls the plugin to handle adding and removing trigger event sources.

## Testing

Systems tests are available which verifies the following behaviour for the pluggable feed provider:

- Register new triggers for an example feed.
- Retrieve details of registered triggers.
- Fire triggers on external events.
- Allow removal of registered triggers.

### Setup

These tests use an example "no-op" feed plugin, which fires a single event after trigger registration. This code is available in the `./provider/tests/resources/noop-trigger-feed` directory. Before running the tests, make sure the feed actions have been installed into an instance of the platform using this plugin as the event provider. The provider backend also needs running with this plugin.

The following environment variables need defining before the tests can be executed.

- `OW_NOOP_FEED`: trigger feed action identifier (e.g. `/<NS>/noop-trigger-feed/changes`)
- `OW_APIHOST`: Apache OpenWhisk platform hostname.
- `OW_API_KEY`: API key for Apache OpenWhisk instance.

### Running

```
npm test
```

The tests consist of a single test case which runs through all the behaviours above with the sample event provider plugin. If successful, the following output should be shown in the console.

```
> openwhisk-pluggable-provider@0.0.1 test ~/generic-provider/provider
> ava tests/index.js

  ✔ should be able to create trigger with pluggable provider feed source (3.2s)

  1 test passed
```
