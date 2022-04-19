exports.loadBiasMap = function loadBiasMap(value, value_safe, value_loaded, value_worst, bias_loaded, bias_max) {
  let high_is_bad = value_loaded > value_safe;
  if (high_is_bad) {
    if (value <= value_safe) {
      return 0;
    }
    if (value <= value_loaded) {
      return (value - value_safe) / (value_loaded - value_safe) * bias_loaded;
    }
    if (value <= value_worst) {
      return bias_loaded + (value - value_loaded) / (value_worst - value_loaded) * (bias_max - bias_loaded);
    }
    return bias_max;
  } else {
    if (value >= value_safe) {
      return 0;
    }
    if (value >= value_loaded) {
      return (value_safe - value) / (value_safe - value_loaded) * bias_loaded;
    }
    if (value >= value_worst) {
      return bias_loaded + (value_loaded - value) / (value_loaded - value_worst) * (bias_max - bias_loaded);
    }
    return bias_max;
  }
};
