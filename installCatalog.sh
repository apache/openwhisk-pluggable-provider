#!/bin/bash
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
# use the command line interface to install standard actions deployed
# automatically
#
# To run this command
# ./installCatalog.sh <authkey> <edgehost> <dburl> <dbprefix> <apihost> <workers>

set -e
set -x

: ${WSK_CLI:?"WSK_CLI must be set and non-empty"}

if [ $# -eq 0 ]; then
    echo "Usage: ./installCatalog.sh <authkey> <edgehost> <dburl> <dbtable> <apihost> <workers>"
fi

AUTH="$1"
EDGEHOST="$2"
DB_URL="$3"
DB_NAME="$4"
APIHOST="$5"
NAMESPACE="$6"
WORKERS="$7"
ACTION_RUNTIME_VERSION=${ACTION_RUNTIME_VERSION:="nodejs:10"}
EVENT_PROVIDER_LIB=${EVENT_PROVIDER_LIB:=$EVENT_PROVIDER}

# If the auth key file exists, read the key in the file. Otherwise, take the
# first argument as the key itself.
if [ -f "$AUTH" ]; then
    AUTH=`cat $AUTH`
fi

# Make sure that the EDGEHOST is not empty.
: ${EDGEHOST:?"EDGEHOST must be set and non-empty"}

# Make sure that the DB_URL is not empty.
: ${DB_URL:?"DB_URL must be set and non-empty"}

# Make sure that the DB_NAME is not empty.
: ${DB_NAME:?"DB_NAME must be set and non-empty"}

# Make sure that the APIHOST is not empty.
: ${APIHOST:?"APIHOST must be set and non-empty"}

# Make sure that the EVENT_PROVIDER is not empty.
: ${EVENT_PROVIDER:?"EVENT_PROVIDER must be set and non-empty"}

# Make sure that the NAMESPACE is not empty.
: ${NAMESPACE:?"NAMESPACE must be set and non-empty"}
PACKAGE_HOME="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

export WSK_CONFIG_FILE= # override local property file to avoid namespace clashes

echo Installing Event Provider package.

$WSK_CLI -i --apihost "$EDGEHOST" package update --auth "$AUTH" --shared yes /$NAMESPACE/$EVENT_PROVIDER \
    -a description "$EVENT_PROVIDER service" \
    -p EVENT_PROVIDER $EVENT_PROVIDER \
    -p NAMESPACE $NAMESPACE \
    -p apihost "$APIHOST"

# make changesFeed.zip
cd actions/event-actions

if [ -e changesFeed.zip ]; then
    rm -rf changesFeed.zip
fi

cp -f changesFeed_package.json package.json
npm install
zip -r changesFeed.zip lib package.json changes.js node_modules

$WSK_CLI -i --apihost "$EDGEHOST" action update --kind "$ACTION_RUNTIME_VERSION" --auth "$AUTH" /$NAMESPACE/$EVENT_PROVIDER/changes "$PACKAGE_HOME/actions/event-actions/changesFeed.zip" \
    -t 90000 \
    -a feed true \
    -a description 'Event provider change feed'

WEB="-web"

COMMAND=" -i --apihost $EDGEHOST package update --auth $AUTH --shared no /$NAMESPACE/$EVENT_PROVIDER$WEB \
     -p DB_URL $DB_URL \
     -p DB_NAME $DB_NAME \
     -p EVENT_PROVIDER $EVENT_PROVIDER \
     -p apihost $APIHOST"

if [ -n "$WORKERS" ]; then
    COMMAND+=" -p workers $WORKERS"
fi

$WSK_CLI $COMMAND

# make changesWebAction.zip
cp -f changesWeb_package.json package.json
npm install
npm install $EVENT_PROVIDER_LIB

if [ -e changesWebAction.zip ]; then
    rm -rf changesWebAction.zip
fi

zip -r changesWebAction.zip lib package.json changesWebAction.js node_modules

$WSK_CLI -i --apihost "$EDGEHOST" action update --kind "$ACTION_RUNTIME_VERSION" --auth "$AUTH" /$NAMESPACE/$EVENT_PROVIDER$WEB/changesWebAction "$PACKAGE_HOME/actions/event-actions/changesWebAction.zip" \
    -a description 'Create/Delete Event triggers in provider database' \
    --web true
