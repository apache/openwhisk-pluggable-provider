module.exports = function (trigger_manager, logger) {
  const add = async (trigger_id, trigger_params) => {
    setTimeout(() => {
      console.log('firing trigger once', trigger_id, trigger_params)
      trigger_manager.fireTrigger(trigger_id, trigger_params)
    }, 1000)
  }
  const remove = async trigger_id => {}

  return { add, remove }
}

module.exports.validate = async trigger_params => ({})
