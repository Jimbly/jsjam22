import path from 'path';

function notNodeModules(filename: string): boolean {
  return !filename.includes('node_modules');
}

let project_root = `${path.resolve(__dirname, '../..')}/`.replace(/\\/g, '/');
function relpath(filename: string): string {
  filename = filename.replace(/\\/g, '/');
  if (filename.startsWith(project_root)) {
    return filename.slice(project_root.length);
  }
  return filename;
}

process.on('exit', function () {
  let deps = Object.keys(require.cache).filter(notNodeModules).map(relpath);
  if (process.send) {
    process.send!({ type: 'deps', deps });
  } else {
    console.log('Test deps = ', deps);
  }
});
