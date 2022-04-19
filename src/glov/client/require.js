/* globals self */
const glob = typeof window === 'undefined' ? self : window;
let deps = glob.deps = glob.deps || {};
glob.require = function (mod) {
  if (!deps[mod]) {
    throw new Error(`Cannot find module '${mod}' (add it to deps.js or equivalent)`);
  }
  return deps[mod];
};
