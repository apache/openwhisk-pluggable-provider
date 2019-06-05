#!/bin/bash

set -e
set -u

npm install $EVENT_PROVIDER
npm start
