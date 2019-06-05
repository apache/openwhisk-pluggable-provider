"use strict";

import test from 'ava';
import openwhisk from 'openwhisk';

const TEST_TRIGGER = 'test-trigger'
const TEST_RULE = 'test-rule'

test.before(async t => {
  if (!process.env.OW_APIHOST) {
    throw new Error('Missing OW_APIHOST environment parameter')
  }

  if (!process.env.OW_API_KEY) {
    throw new Error('Missing OW_API_KEY environment parameter')
  }

  if (!process.env.OW_NOOP_FEED) {
    throw new Error('Missing OW_NOOP_FEED environment parameter')
  }

  const options = { apihost: process.env.OW_APIHOST, api_key: process.env.OW_API_KEY }
  const ow = openwhisk(options)
  t.context.ow = ow

  await ow.triggers.update({ name: TEST_TRIGGER })
  await ow.rules.update({name: TEST_RULE, action: '/whisk.system/utils/echo', trigger: TEST_TRIGGER})
})

test('should be able to create trigger with pluggable provider feed source', async t => {
  const params = {trigger_payload: {value: 'testing 1 2 3'}}
  const name = process.env.OW_NOOP_FEED

  const ow = t.context.ow

  const now = Date.now()

  // register trigger feed with provider
  const create_result = await ow.feeds.create({name, trigger: TEST_TRIGGER, params})
  t.true(create_result.response.success, 'create trigger feed worked')

  // retrieve trigger details from feed provider
  const result = await ow.feeds.get({name, trigger: TEST_TRIGGER})

  t.true(result.response.result.status.active, 'test trigger feed is enabled')
  t.true(result.response.result.config._id.endsWith(TEST_TRIGGER))
  
  let activations = []
  while(activations.length < 1) {
    activations = await ow.activations.list({since: now})
    activations = activations.filter(actv => actv.name === 'echo')
  }

  // remote trigger from feed provider
  await ow.feeds.delete({name, trigger: TEST_TRIGGER})

  // should fail to retrieve once trigger is removed from feed provider.
  try {
    await ow.feeds.get({name, trigger: TEST_TRIGGER})
    t.fail()
  } catch (err) {
    t.true(!!err.message.match('could not find trigger'));
  }
});

test.after.always('cleanup', async t => {
  const ow = t.context.ow

  await ow.triggers.delete({ name: TEST_TRIGGER })
  await ow.rules.delete({ name: TEST_RULE })
});
