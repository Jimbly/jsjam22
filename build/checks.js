const fs = require('fs');
const JSON5 = require('json5');
const args = require('minimist')(process.argv.slice(2));

function requireVersion(dep, required) {
  let ver;
  if (dep === 'nodejs') {
    ver = process.versions.node;
  } else {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      ver = require(`${dep}/package.json`).version;
    } catch (e) {
      return `"${dep}": missing`;
    }
  }
  ver = ver.split('.').map(Number);
  if (ver.length !== 3) {
    return `"${dep}": unable to parse version for package`;
  }
  required = required.split('.').map(Number);
  if (ver[0] !== required[0] || ver[1] < required[1] || ver[1] === required[1] && ver[2] < required[2]) {
    return `"${dep}": expected ${required.join('.')}+, found ${ver.join('.')}`;
  }
  return null;
}
function requireVersions(versions) {
  let errors = [];
  for (let key in versions) {
    let err = requireVersion(key, versions[key]);
    if (err) {
      errors.push(err);
    }
  }
  if (errors.length) {
    console.error('Required dependencies missing or out of date:');
    for (let ii = 0; ii < errors.length; ++ii) {
      console.error(`  ${errors[ii]}`);
    }
    console.error('Please run `npm i` to install them.');
    process.exit(-1);
  }
}

module.exports = function (filename) {
  if (fs.readFileSync(filename, 'utf8').includes('\r\n')) {
    // CRLF Line endings currently break gulp-ifdef, mess up with git diff/log/blame, and
    //   cause unnecessary diffs when pushing builds to production servers.
    console.error('ERROR: Windows line endings detected');
    console.error('Check your git config and make sure core.autocrlf is false:\n' +
      '  git config --get core.autocrlf\n' +
      '  git config --global --add core.autocrlf false\n' +
      '    (or --local if you want it on for other projects)');
    process.exit(-1);
  }

  function prettyInterface() {
    // eslint-disable-next-line global-require
    const console_api = require('console-api');
    console_api.setPalette(console_api.palettes.desaturated);
    let project_name = 'glov';
    try {
      let pkg = JSON5.parse(fs.readFileSync('./package.json', 'utf8'));
      if (pkg && pkg.name) {
        project_name = pkg.name;
      }
    } catch (e) {
      // ignored, use default
    }
    console_api.setTitle(args.title || `build ${args._ || filename} | ${project_name}`);
  }
  prettyInterface();

  requireVersions({
    'nodejs': '16.13.0',
    'glov-build': '1.0.43',
    'glov-build-browserify': '1.0.8',
    'glov-build-cache': '1.1.0',
    'glov-build-concat': '1.0.10',
    'glov-build-preresolve': '1.2.0',
    '@jimbly/howler': '0.0.9',
    '@jimbly/babel-plugin-transform-modules-simple-commonjs': '0.0.3',
  });
};
